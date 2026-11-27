// The live engine (ADR-016): the C++ engine header compiled to WebAssembly, single-threaded per
// instance, with a run split across a pool of Web Workers. This module is the only thing the page
// talks to; cpp/wasm/live.cpp is the other side, viz/js/engine-worker.js hosts a pooled instance.

// Order of the doubles the C side reads; must match `enum Input` in cpp/wasm/live.cpp.
const CONDITION_KEYS = ['sigma_swing', 'sigma_seam', 'e_z', 'sigma_ez', 'pace_retention', 'tilt', 'wind_y', 'release_y', 'reaction_time'];
const RELEASE_KEYS = ['x', 'z', 'line'];
const INPUT_NAMES = [
  ...CONDITION_KEYS.map((k) => `conditions.${k}`), ...RELEASE_KEYS.map((k) => `release.${k}`),
  'length', 'speedKmh', 'swing', 'crosswind', 'wicketCost', 'runsMiddled', 'catchConversion',
];
const LENGTHS = ['good', 'yorker', 'bouncer']; // DeliveryLength's order in the engine header
const LEAVE = ['safe', 'bowled'];
const PLAY = ['middled', 'edged_safe', 'edged_carried', 'missed', 'missed_bowled'];
const COUNTS = 7; // n, bowled when left, then the five play outcomes
const BAD_COUNT = 100;
const ARRIVALS = 256;
const PIECES_PER_WORKER = 4;
const READY_MS = 10000;

// One engine instance. Used in the page, and by each pooled worker. Exported for the worker and the tests.
export async function createInstance() {
  // Imported here, not at the top, so a missing or broken module rejects instead of breaking the importer.
  const { default: createModule } = await import('../wasm/engine.mjs');
  const m = await createModule();
  const at = (pointer, length) => m.HEAPF64.subarray(pointer / 8, pointer / 8 + length);
  const inputs = at(m._live_inputs(), INPUT_NAMES.length);
  const counts = at(m._live_counts(), COUNTS);
  const outputs = at(m._live_outputs(), 15);
  const load = (values) => values.forEach((v, i) => { inputs[i] = v; });
  const pathOf = () => {
    const points = outputs[9];
    const flat = at(m._live_path(), 3 * points);
    return { path: Array.from({ length: points }, (_, i) => [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]]), bounceIndex: outputs[8] };
  };
  return {
    module: m,
    check(values) { load(values); return m._live_check(); },
    // Deliveries [first, first + count) of the batch: their outcome counts, and the arrivals of those below index 256.
    simulate(values, first, count, seed) {
      load(values);
      const code = m._live_simulate(first, count, seed);
      const end = Math.min(first + count, ARRIVALS);
      const arrivals = end > first ? at(m._live_arrivals(), 2 * end).slice(2 * first) : new Float64Array(0);
      return { code, first, counts: Array.from(counts), arrivals };
    },
    summarize(values, merged) {
      load(values);
      merged.forEach((v, i) => { counts[i] = v; });
      const code = m._live_summarize();
      return { code, outputs: Array.from(outputs.subarray(0, 8)), ...pathOf() };
    },
    sample(values, index, seed) {
      load(values);
      const code = m._live_sample(index, seed);
      return { code, leave: outputs[10], play: outputs[11], caught: outputs[12], x: outputs[13], z: outputs[14], ...pathOf() };
    },
  };
}

// Chunks merge by adding their integer counts; arrivals land at their delivery index. Exported for the tests.
export function mergeChunks(chunks, n) {
  const counts = new Array(COUNTS).fill(0);
  const arrivals = new Float64Array(2 * Math.min(n, ARRIVALS));
  for (const c of chunks) {
    c.counts.forEach((v, i) => { counts[i] += v; });
    if (2 * c.first < arrivals.length) arrivals.set(c.arrivals.subarray(0, arrivals.length - 2 * c.first), 2 * c.first);
  }
  return { counts, arrivals };
}

function workerExecutor(Worker) {
  const worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let next = 0;
  const ready = new Promise((resolve, reject) => {
    worker.addEventListener('error', (e) => reject(new Error(`engine worker failed: ${e.message ?? e}`)));
    worker.addEventListener('message', ({ data }) => {
      if (data.ready) resolve();
      else if (data.failed) reject(new Error(data.failed));
      else { pending.get(data.id)(data); pending.delete(data.id); }
    });
  });
  return {
    ready,
    terminate: () => worker.terminate(),
    simulate: (values, first, count, seed) => new Promise((resolve) => {
      const id = next++;
      pending.set(id, resolve);
      worker.postMessage({ id, values, first, count, seed });
    }),
  };
}

// Pooled instances: Web Workers where they exist, else one instance in the page.
// `workers` defaults to one per logical core, at most 16 (the page's thread only waits during a run);
// `Worker` lets a host
// without Web Workers (Node's worker_threads, in the tests) supply a compatible constructor.
export async function loadEngine({ workers, Worker = globalThis.Worker } = {}) {
  if (typeof WebAssembly !== 'object') throw new Error('this browser has no WebAssembly');
  const main = await createInstance();
  const m = main.module;
  const cores = globalThis.navigator?.hardwareConcurrency ?? 4;
  const wanted = workers ?? Math.max(1, Math.min(cores, 16));
  let executors = [{ simulate: async (...a) => main.simulate(...a) }];
  if (typeof Worker === 'function' && wanted >= 1) {
    const pool = Array.from({ length: wanted }, () => workerExecutor(Worker));
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('engine worker timed out')), READY_MS); });
    const loaded = await Promise.allSettled(pool.map((w) => Promise.race([w.ready, timeout])));
    clearTimeout(timer);
    const ready = pool.filter((w, i) => (loaded[i].status === 'fulfilled' ? true : (w.terminate(), false)));
    if (ready.length > 0) executors = ready; // else module workers are unavailable: keep the in-page instance
    else console.warn('live engine: no worker started, running in the page:', loaded[0].reason?.message);
  }

  // The C side multiplies m/s by 3.6, which can leave the last bit off a round km/h figure.
  const kmh = (v) => Math.round(v * 1e9) / 1e9;
  const limit = (i) => m._live_limit(i);
  const limits = Object.freeze({
    speedKmh: Object.freeze([kmh(limit(0)), kmh(limit(1))]),
    swing: Object.freeze([limit(2), limit(3)]),
    wind: Object.freeze([limit(4), limit(5)]),
  });
  const releaseY = m._live_release_y();
  const lengths = Object.freeze(Object.fromEntries(LENGTHS.map((name, i) => {
    const bounceY = m._live_length(i);
    return [name, Object.freeze({ bounceY, fromRelease: releaseY - bounceY })]; // from the stumps; from the release plane
  })));
  const capacity = m._live_capacity();
  const rangeHint = {
    speedKmh: `${limits.speedKmh[0]} to ${limits.speedKmh[1]} km/h`,
    swing: `${limits.swing[0]} to ${limits.swing[1]}`,
    crosswind: `${limits.wind[0]} to ${limits.wind[1]} m/s, and wind speed with conditions.wind_y at most ${limits.wind[1]} m/s`,
  };

  const fail = (code, values, n) => {
    if (code === BAD_COUNT) throw new RangeError(`n must be from 1 to ${capacity}, got ${n}`);
    const name = INPUT_NAMES[code - 1];
    const shown = name === 'length' ? `'${LENGTHS[values[code - 1]] ?? 'unknown'}'` : values[code - 1];
    const hint = rangeHint[name] ? ` (allowed: ${rangeHint[name]})` : '';
    throw new RangeError(`${name} = ${shown} is outside the engine's envelope${hint}`);
  };

  // Checks everything the C side cannot see, then everything it can; returns the input doubles.
  function prepare({ conditions, release, length = 'good', speedKmh, swing, crosswind, wicketCost, runsMiddled, catchConversion, n = 50000, seed = 1 }) {
    if (!Number.isInteger(n) || n < 1 || n > capacity) throw new RangeError(`n must be a whole number from 1 to ${capacity}, got ${n}`);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new RangeError(`seed must be a whole number from 0 to 4294967295, got ${seed}`);
    if (!conditions || !release) throw new RangeError('conditions and release are required');
    if (!LENGTHS.includes(length)) throw new RangeError(`length must be one of ${LENGTHS.join(', ')}, got ${length}`);
    const values = [
      ...CONDITION_KEYS.map((k) => conditions[k]), ...RELEASE_KEYS.map((k) => release[k]),
      LENGTHS.indexOf(length), speedKmh, swing, crosswind, wicketCost, runsMiddled, catchConversion,
    ].map((v) => (typeof v === 'number' ? v : NaN));
    const code = main.check(values);
    if (code !== 0) fail(code, values, n);
    return { values, n, seed };
  }

  async function run(args) {
    const { values, n, seed } = prepare(args);
    const start = performance.now();
    const used = Math.min(executors.length, n);
    // Several pieces per worker, handed out as workers come free: cores differ in speed (hybrid CPUs),
    // so equal shares would wait for the slowest. Which worker runs a piece changes no result.
    const pieces = used === 1 ? 1 : Math.min(n, PIECES_PER_WORKER * used);
    const bound = (k) => Math.floor((n * k) / pieces);
    const chunks = [];
    let next = 0;
    await Promise.all(executors.slice(0, used).map(async (e) => {
      while (next < pieces) {
        const k = next++;
        chunks.push(await e.simulate(values, bound(k), bound(k + 1) - bound(k), seed));
      }
    }));
    for (const c of chunks) if (c.code !== 0) fail(c.code, values, n);
    const { counts, arrivals } = mergeChunks(chunks, n);
    const s = main.summarize(values, counts);
    if (s.code !== 0) fail(s.code, values, n);
    const ms = performance.now() - start;
    const [pWicketLeave, pWicketPlay, pMiddled, pEdged, pEdgedCarried, pMissed, evLeave, evPlay] = s.outputs;
    return {
      n, ms, threads: used, pWicketLeave, pWicketPlay, pMiddled, pEdged, pEdgedCarried, pMissed,
      evLeave, evPlay, best: evPlay > evLeave ? 'play' : 'leave', arrivals, path: s.path, bounceIndex: s.bounceIndex,
    };
  }

  // One delivery of the batch `run` would simulate with the same arguments.
  async function sample({ index, ...args }) {
    const { values, n, seed } = prepare(args);
    if (!Number.isInteger(index) || index < 0 || index >= n) throw new RangeError(`index must be a whole number from 0 to ${n - 1}, got ${index}`);
    const s = main.sample(values, index, seed);
    if (s.code !== 0) fail(s.code, values, n);
    const play = s.play === 2 ? (s.caught ? 'edged_caught' : 'edged_safe') : PLAY[s.play]; // as fan_outcomes
    return { path: s.path, bounceIndex: s.bounceIndex, leave: LEAVE[s.leave], play, atStumps: { x: s.x, z: s.z } };
  }

  return Object.freeze({ capacity, limits, lengths, threads: executors.length, run, sample });
}

// The live WebAssembly engine (ADR-016). Run with: node --test viz/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker as ThreadWorker } from 'node:worker_threads';
import { createInstance, loadEngine, mergeChunks } from '../js/engine-wasm.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const live = JSON.parse(read('../data/live.json'));
const published = JSON.parse(read('../data/trajectories.json'));
const engine = await loadEngine(); // Node has no Web Workers: one in-page instance

// worker_threads behind the Web Worker interface the pool uses. Every one started is stopped at the
// end of the test that started it, so the test process can exit.
const started = [];
class NodeWorker {
  constructor(url) { this.w = new ThreadWorker(url); started.push(this.w); }
  postMessage(message) { this.w.postMessage(message); }
  addEventListener(type, handle) { this.w.on(type, type === 'message' ? (data) => handle({ data }) : handle); }
  terminate() { return this.w.terminate(); }
}

const inputsFor = (venue, arm, extra = {}) => {
  const v = live.venues[venue];
  return {
    conditions: v.conditions, release: live.release[arm], speedKmh: 135, swing: v.swing[arm], crosswind: v.crosswind,
    wicketCost: live.wicket_cost.by_wickets_lost[published.meta.wickets_lost], runsMiddled: v.runs_middled,
    catchConversion: v.catch_conversion, ...extra,
  };
};
const withoutTime = ({ ms, threads, arrivals, ...rest }) => ({ ...rest, arrivals: Array.from(arrivals) });

test('the module loads and reports its capacity, limits and lengths from the C++ constants', () => {
  const header = read('../../cpp/include/fourth_stump_envelope.hpp');
  const constant = (name) => Number(header.match(new RegExp(`${name} = ([0-9.]+)`))[1]);
  assert.deepEqual(engine.limits, {
    speedKmh: [constant('kMinSpeed'), constant('kMaxSpeed')], // declared as km/h / 3.6
    swing: [-constant('kMaxSwing'), constant('kMaxSwing')],
    wind: [-constant('kMaxWind'), constant('kMaxWind')],
  });
  const capacity = Number(read('../../cpp/wasm/live.cpp').match(/kCapacity = ([0-9']+);/)[1].replaceAll("'", ''));
  assert.equal(engine.capacity, capacity);
  assert.ok(engine.capacity >= 50000);
  assert.equal(engine.threads, 1);
  for (const [name, target] of Object.entries(engine.lengths)) {
    assert.equal(target.bounceY, live.lengths[name].bounce_y, name); // live.json gets them from the header through Python
    assert.equal(target.fromRelease, live.lengths[name].from_release, name);
  }
  assert.ok(engine.lengths.bouncer.fromRelease >= 9.5 && engine.lengths.bouncer.fromRelease <= 11.0);
  assert.ok(engine.lengths.yorker.fromRelease >= 18.8 && engine.lengths.yorker.fromRelease <= 19.8);
});

test('the same seed gives identical results, another seed does not', async () => {
  const a = withoutTime(await engine.run(inputsFor('lords', 'right', { n: 20000, seed: 7 })));
  const b = withoutTime(await engine.run(inputsFor('lords', 'right', { n: 20000, seed: 7 })));
  const c = withoutTime(await engine.run(inputsFor('lords', 'right', { n: 20000, seed: 8 })));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.arrivals, c.arrivals);
  assert.equal(a.arrivals.length, 512);
  assert.equal((await engine.run(inputsFor('lords', 'right', { n: 100 }))).arrivals.length, 200);
});

test('a batch split into chunks at any boundaries merges to the same counts and arrivals as one call', async () => {
  const instance = await createInstance();
  const prepared = await engine.sample({ ...inputsFor('newlands', 'left'), index: 0 }); // proves the inputs are valid
  assert.ok(prepared.path.length > 0);
  const v = live.venues.newlands;
  const values = [...Object.values(v.conditions), 0 - 0.75, 2.08, 0, 0, 135, v.swing.left, v.crosswind, 38, 0.9, v.catch_conversion];
  const n = 9000, seed = 5;
  const whole = mergeChunks([instance.simulate(values, 0, n, seed)], n);
  for (const cuts of [[0, 100, 9000], [0, 255, 256, 257, 4096, 4097, 9000], [0, 1, 2, 3000, 6000, 8999, 9000]]) {
    const chunks = cuts.slice(1).map((end, k) => instance.simulate(values, cuts[k], end - cuts[k], seed));
    const merged = mergeChunks(chunks.reverse(), n); // order of arrival does not matter
    assert.deepEqual(merged.counts, whole.counts, `${cuts}`);
    assert.deepEqual(Array.from(merged.arrivals), Array.from(whole.arrivals), `${cuts}`);
  }
});

test('a pool of worker threads gives the same result as one instance, for any number of workers', async (t) => {
  t.after(() => Promise.all(started.map((w) => w.terminate())));
  const args = inputsFor('perth', 'left', { n: 30001, seed: 3, length: 'yorker' });
  const one = withoutTime(await engine.run(args));
  for (const workers of [1, 3, 4]) {
    const pool = await loadEngine({ workers, Worker: NodeWorker });
    assert.equal(pool.threads, workers);
    const result = await pool.run(args);
    assert.equal(result.threads, workers);
    assert.deepEqual(withoutTime(result), one, `${workers} workers`);
    const [x, y] = await Promise.all([pool.run(args), pool.run({ ...args, seed: 4 })]); // overlapping runs keep apart
    assert.deepEqual(withoutTime(x), one);
    assert.notDeepEqual(withoutTime(y).arrivals, one.arrivals);
  }
});

test('one sampled delivery is the same delivery as in the batch, in the fan_outcomes vocabulary', async () => {
  const args = inputsFor('lords', 'right', { n: 2000, seed: 9 });
  const batch = await engine.run(args);
  let bowled = 0, middled = 0, edged = 0, missed = 0;
  for (let index = 0; index < 2000; ++index) {
    const s = await engine.sample({ ...args, index });
    assert.ok(['safe', 'bowled'].includes(s.leave));
    assert.ok(['middled', 'edged_safe', 'edged_caught', 'missed', 'missed_bowled'].includes(s.play));
    if (index < 256) assert.deepEqual([s.atStumps.x, s.atStumps.z], [batch.arrivals[2 * index], batch.arrivals[2 * index + 1]]);
    if (index === 0) assert.ok(s.path.length >= 48 && s.path[0][1] === live.venues.lords.conditions.release_y);
    bowled += s.leave === 'bowled';
    middled += s.play === 'middled';
    edged += s.play.startsWith('edged');
    missed += s.play.startsWith('missed');
  }
  assert.equal(bowled / 2000, batch.pWicketLeave);
  assert.equal(middled / 2000, batch.pMiddled);
  assert.equal(edged / 2000, batch.pEdged);
  assert.equal(missed / 2000, batch.pMissed);
});

test('each named length aims the mean delivery where its target says', async () => {
  for (const venue of Object.keys(live.venues)) {
    const run = (length) => engine.run(inputsFor(venue, 'right', { n: 1000, length }));
    const good = await run('good'), bouncer = await run('bouncer'), yorker = await run('yorker');
    const bounceY = (r) => r.path[r.bounceIndex][1];
    assert.ok(Math.abs(bounceY(good) - engine.lengths.good.bounceY) < 0.35, venue);
    assert.ok(Math.abs(bounceY(bouncer) - engine.lengths.bouncer.bounceY) < 0.75, venue);
    assert.equal(yorker.bounceIndex, -1, venue); // on the full at the stumps
    assert.ok(yorker.path.at(-1)[2] < 0.2, venue);
    assert.ok(bouncer.path.at(-1)[2] > good.path.at(-1)[2], venue);
  }
});

// ADR-003's cross-platform promise is statistical. Each published probability comes from
// 200,000 native deliveries (seed 2026); these are 50,000 WebAssembly deliveries with seed 1,
// independent of them. The difference of two independent binomial estimates has standard error
// sqrt(p (1 - p) (1/50000 + 1/200000)); the tolerance is four of those plus the 5e-6 the
// published figures are rounded to. p_wicket_play mixes two exclusive outcomes with weights at
// most 1, so its variance is no larger than a binomial's with the same mean.
for (const venue of Object.keys(live.venues)) {
  for (const arm of published.arms) {
    test(`${venue}, ${arm}-arm: 50,000 WebAssembly deliveries reproduce the native engine's probabilities`, async () => {
      const s = published.scenarios.find((x) => x.venue === venue && x.arm === arm && x.ball_age === live.meta.ball_age
        && x.end === live.meta.bowling_end);
      const r = await engine.run(inputsFor(venue, arm));
      const n = r.n, m = published.meta.deliveries_per_estimate;
      for (const [mine, theirs] of [['pWicketLeave', 'p_wicket_leave'], ['pWicketPlay', 'p_wicket_play'],
        ['pMiddled', 'p_middled'], ['pEdged', 'p_edged'], ['pMissed', 'p_missed']]) {
        const p = s[theirs];
        const tolerance = 4 * Math.sqrt(p * (1 - p) * (1 / n + 1 / m)) + 5e-6;
        assert.ok(Math.abs(r[mine] - p) <= tolerance, `${mine}: ${r[mine]} against ${p}, tolerance ${tolerance}`);
      }
      assert.ok(Math.abs(r.pMiddled + r.pEdged + r.pMissed - 1) < 1e-12);
      assert.ok(r.pEdgedCarried <= r.pEdged);
      assert.equal(r.best, s.best);
      // The mean delivery's path is the same geometry: published rounded to 4 decimals.
      assert.equal(r.bounceIndex, s.bounce_index);
      assert.equal(r.path.length, s.path.length);
      r.path.forEach((point, i) => point.forEach((v, k) => assert.ok(Math.abs(v - s.path[i][k]) <= 5.1e-5, `path[${i}][${k}]`)));
    });
  }
}

test('an input outside the envelope rejects with a RangeError and computes nothing', async () => {
  const before = withoutTime(await engine.run(inputsFor('perth', 'right', { n: 1000 })));
  const bad = [
    { speedKmh: 119.9 }, { speedKmh: 150.1 }, { swing: 0.31 }, { swing: -0.31 }, { crosswind: 5.01 }, { crosswind: NaN },
    { release: { ...live.release.right, z: 3 } }, { release: { ...live.release.right, x: 1.2 } }, { length: 'beamer' },
    { conditions: { ...live.venues.perth.conditions, e_z: 1.2 } }, { conditions: { ...live.venues.perth.conditions, sigma_seam: undefined } },
    { catchConversion: 1.5 }, { wicketCost: -1 }, { n: 0 }, { n: engine.capacity + 1 }, { n: 10.5 }, { seed: -1 },
  ];
  for (const extra of bad) {
    await assert.rejects(engine.run(inputsFor('perth', 'right', extra)), RangeError, JSON.stringify(extra));
    await assert.rejects(engine.sample({ ...inputsFor('perth', 'right', extra), index: 0 }), RangeError, JSON.stringify(extra));
  }
  await assert.rejects(engine.sample({ ...inputsFor('perth', 'right', { n: 10 }), index: 10 }), RangeError);
  // The envelope bounds wind speed: Newlands has wind along the pitch, so a 5 m/s crosswind is outside it.
  await assert.rejects(engine.run(inputsFor('newlands', 'right', { crosswind: 5 })), /crosswind/);
  await engine.run(inputsFor('newlands', 'right', { crosswind: live.venues.newlands.max_crosswind - 1e-9, n: 100 }));
  for (const speedKmh of engine.limits.speedKmh) await engine.run(inputsFor('perth', 'right', { speedKmh, n: 100 }));
  assert.deepEqual(withoutTime(await engine.run(inputsFor('perth', 'right', { n: 1000 }))), before);
});

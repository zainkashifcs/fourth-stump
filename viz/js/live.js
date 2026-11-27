// "Live engine": sliders drive the C++ engine compiled to WebAssembly, and
// every change simulates a fresh batch of deliveries in the browser. When the
// engine or data/live.json cannot be had, it shows the nearest precomputed
// scenario from trajectories.json instead.
//
// The engine and its settings are passed in, so the view runs against a
// stand-in as well as the real module:
//   loadEngine(): Promise<{ capacity, threads, limits: { speedKmh, swing, wind }, lengths,
//     run(args): Promise<result>, sample({ ...args, index }): Promise<{ path, bounceIndex, leave, play }> }>
//   loadLive(): Promise<live.json>
//     { meta: { ball_age, bowling_end }, release: { right, left },
//       venues: { <key>: { name, conditions, catch_conversion, runs_middled } },
//       wicket_cost: { ball_age, by_wickets_lost: [10 numbers] } }
import { h, segmented } from './dom.js';
import { venueKeys } from './data.js';
import { actionLabel, armLabel, outcomeLabel, overs, runs } from './format.js';
import { actionTable, splitBar, venueColor } from './numbers.js';
import { renderEndOn } from './endon.js';
import { createCaption } from './caption.js';
import {
  STEPS, arrivalPoints, asScenario, bowlIndex, bowledWith, coalesce, count, latestOnly, lengthOptions, nearestScenario, runArgs,
  standardDelivery, statusLine, windRange,
} from './live-logic.js';

const NO_WASM = 'WebAssembly is not available here, so this shows the precomputed result for the standard delivery.';
const NO_SETTINGS = "The live engine's settings file did not load, so this shows the precomputed result for the standard delivery.";

const MINUS = '−';
const signed = (value, digits) => `${value < 0 ? MINUS : '+'}${Math.abs(value).toFixed(digits)}`;
const wickets = (n) => `${n} ${n === 1 ? 'wicket' : 'wickets'} lost`;
const lastPoint = (path) => [path[path.length - 1][0], path[path.length - 1][2]];

// A native range input with its label, its value and words for its two ends.
function slider({ id, label, ends, format, spoken = format, onInput }) {
  const output = h('output', { for: id, class: 'age-value' });
  const input = h('input', { type: 'range', id, oninput: () => onInput(Number(input.value)) });
  const el = h(
    'div',
    { class: 'field live-field' },
    h('div', { class: 'age-head' }, h('label', { for: id, text: label }), output),
    input,
    h('div', { class: 'live-ends', 'aria-hidden': 'true' }, ends.map((text) => h('span', { text }))),
  );
  return {
    el,
    // range: [min, max] and the step, or null to disable the slider and show no value
    set(value, range, step, disabled = !range) {
      input.disabled = disabled;
      if (!range) {
        output.textContent = '—';
        input.removeAttribute('aria-valuetext');
        return;
      }
      Object.assign(input, { min: range[0], max: range[1], step });
      input.value = value;
      output.textContent = format(value);
      input.setAttribute('aria-valuetext', spoken(value));
    },
  };
}

export function createLive(data, stage, { loadEngine, loadLive, nowasm = false }) {
  const { constants } = data.meta;
  const keys = venueKeys(data);
  let state = { venue: keys[0], arm: data.arms[0], length: 'good', speedKmh: 0, swing: 0, crosswind: 0, wicketsLost: data.meta.wickets_lost };
  let engine = null;
  let live = null;
  let mode = 'loading'; // 'loading' | 'live' | 'fallback'
  let reason = '';
  let started = null;
  let active = false;
  let shown = null; // { scenario, arrivals, status } last drawn
  let lastRun = null; // { args } of the batch on screen, which "Leave one" and "Play one" sample
  let bowled = 0; // presses of either on that batch
  const offset = Math.floor(Math.random() * 1e6); // where in a batch they start

  // Controls -----------------------------------------------------------
  function standard(venue, arm, fields) {
    if (mode !== 'live') return {};
    const values = standardDelivery(live, engine.limits, venue, arm);
    return Object.fromEntries(fields.map((field) => [field, values[field]]));
  }
  const venueName = (key) => (live?.venues[key]?.name ?? data.venues[key].name).split(',')[0];
  const venueControl = segmented({
    legend: 'Venue',
    className: 'live-venue',
    options: keys.map((key) => ({ value: key, label: venueName(key) })),
    value: state.venue,
    // a venue brings its own swing and crosswind; an arm its own swing. The speed stays as set.
    onChange: (venue) => change({ venue, ...standard(venue, state.arm, ['swing', 'crosswind']) }),
  });
  const armControl = segmented({
    legend: 'Bowler',
    options: data.arms.map((arm) => ({ value: arm, label: armLabel(arm) })),
    value: state.arm,
    onChange: (arm) => change({ arm, ...standard(state.venue, arm, ['swing']) }),
  });
  const speed = slider({
    id: 'live-speed', label: 'Release speed', ends: ['Slower', 'Faster'],
    format: (v) => `${v} km/h`, spoken: (v) => `${v} kilometres per hour`,
    onInput: (speedKmh) => change({ speedKmh }),
  });
  const swing = slider({
    id: 'live-swing', label: 'Swing coefficient', ends: ['Into the batter', 'Away'],
    format: (v) => signed(v, 3), spoken: (v) => `${signed(v, 3)}, ${v < 0 ? 'into the batter' : 'away from the batter'}`,
    onInput: (value) => change({ swing: value }),
  });
  const wind = slider({
    id: 'live-wind', label: 'Crosswind', ends: ['To leg', 'To off'],
    format: (v) => `${signed(v, 1)} m/s`, spoken: (v) => `${Math.abs(v).toFixed(1)} metres per second towards the ${v < 0 ? 'leg' : 'off'} side`,
    onInput: (crosswind) => change({ crosswind }),
  });
  const lost = slider({
    id: 'live-wickets', label: 'Wickets lost', ends: ['0', '9'], format: String, spoken: wickets,
    onInput: (wicketsLost) => change({ wicketsLost }),
  });
  // the presets come from the engine once it loads; until then the three it is built with
  const lengthSlot = h('div', { class: 'live-length' });
  let lengthControl = null;
  function buildLengths(lengths) {
    lengthControl = segmented({
      legend: 'Length',
      className: 'live-lengths',
      options: lengthOptions(lengths),
      value: state.length,
      onChange: (length) => change({ length }),
    });
    lengthSlot.replaceChildren(lengthControl.el);
  }
  buildLengths({ good: {}, yorker: {}, bouncer: {} });
  // the next delivery of the batch, bowled with the visitor's action; the table's BETTER tag says which is better
  const bowlButtons = ['leave', 'play'].map((action) => h('button', {
    type: 'button', class: 'button live-bowl', 'data-action': action, text: `${actionLabel(action)} one`, onclick: () => bowlOne(action),
  }));
  const note = h('p', { class: 'note-warn live-note', hidden: true });
  const status = h('p', { class: 'live-status' });
  const controls = h(
    'form',
    { class: 'live-controls', 'aria-label': 'Delivery', onsubmit: (event) => event.preventDefault() },
    venueControl.el, armControl.el, lengthSlot, speed.el, swing.el, wind.el, lost.el,
    h('div', { class: 'live-bowl-pair', role: 'group', 'aria-label': 'Bowl one delivery of the batch' }, bowlButtons), note, status,
  );

  // Picture, numbers and the stumps plot ----------------------------------
  const heading = h('h2');
  const viewport = h('div', { class: 'viewport game-viewport', role: 'img' });
  const caption = createCaption(viewport);
  const host = h('div', { class: 'live-stage' }, viewport);
  const picture = h('div', { class: 'live-picture' },
    h('div', { class: 'venue-title' }, heading, h('span', { class: 'venue-meta', text: 'Mean delivery' })), host);
  const card = h('div', { class: 'card live-card' });
  const chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chart.setAttribute('class', 'endon');
  chart.setAttribute('role', 'img');
  const frame = h('div', { class: 'endon-frame' }, chart);
  const key = (name, label) => h('li', {}, h('span', { class: `key key-${name}` }), label);
  const plotKey = h('ul', { class: 'plot-key' }, key('mean', 'Mean'), key('sample', 'Sample'));
  const side = h('div', { class: 'live-side' },
    h('div', { class: 'venue-title' }, h('h2', { text: 'Leave or play' }), h('span', { class: 'venue-meta', text: 'Expected value' })),
    card,
    h('div', { class: 'venue-title live-plot-title' }, h('h2', { text: 'At the stumps' }), plotKey),
    frame);
  const announce = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const el = h('section', { class: 'live', 'aria-label': 'Live engine' }, controls, picture, side, announce);

  // Rendering --------------------------------------------------------------
  const index = () => Math.max(keys.indexOf(state.venue), 0);

  function costLine(cost, wicketsLost, ballAge, source) {
    return h('p', { class: 'cost' }, `Wicket cost ${runs(cost)}`,
      h('span', { class: 'fine', text: ` at ${wickets(wicketsLost)}, ball age ${overs(ballAge)}` }),
      source === 'placeholder' && h('span', { class: 'tag tag-warn', text: 'Placeholder' }));
  }

  function draw({ scenario, arrivals, cost, status: line }) {
    shown = { scenario, arrivals, cost, status: line };
    const color = venueColor(index());
    el.style.setProperty('--venue', color);
    heading.textContent = data.venues[state.venue].name;
    card.replaceChildren(actionTable(scenario), splitBar(scenario), cost);
    status.textContent = line;
    if (!active) return;
    caption.clear();
    stage.setPlay(0, { venue: state.venue, arm: state.arm, path: scenario.path, bounceIndex: scenario.bounce_index, color });
    stage.jumpTo(0, 'end');
    renderEndOn(chart, constants, [{ name: heading.textContent, color, end: lastPoint(scenario.path), fanEnds: arrivals }],
      frame.clientHeight > 0 ? frame.clientWidth / frame.clientHeight : undefined);
    chart.setAttribute('aria-label', `End-on chart of where ${arrivals.length} deliveries and their mean pass the stumps at ${heading.textContent}.`);
    viewport.setAttribute('aria-label', `3D view of the mean delivery at ${heading.textContent}, from behind the stumps.`);
    const words = `${actionLabel(scenario.best)} is the better action.`;
    if (announce.textContent !== words) announce.textContent = words;
  }

  async function runEngine() {
    const args = runArgs(state, live, engine.capacity);
    try {
      const result = await engine.run(args);
      lastRun = { args };
      bowled = 0;
      draw({
        scenario: asScenario(result, args.wicketCost),
        arrivals: arrivalPoints(result.arrivals),
        cost: costLine(args.wicketCost, state.wicketsLost, live.wicket_cost.ball_age, live.meta.wicket_cost_source),
        status: statusLine(result),
      });
    } catch (error) {
      // the sliders stay inside the envelope, so this is a guard, not a path the visitor should meet
      status.textContent = `The engine did not run this delivery: ${error.message}. The numbers shown are for the last one it ran.`;
    }
  }

  function showPrecomputed() {
    const venue = data.venues[state.venue];
    const end = Number.isInteger(live?.meta?.bowling_end) ? live.meta.bowling_end : 0;
    const ballAge = live?.meta?.ball_age ?? data.ball_ages[0];
    const scenario = nearestScenario(data.scenarios, { venue: state.venue, arm: state.arm, ballAge, end });
    if (!scenario) {
      card.replaceChildren(h('p', { class: 'empty', text: 'The data file has no scenario for this case.' }));
      return;
    }
    draw({
      scenario,
      arrivals: (scenario.fan ?? []).map(lastPoint),
      cost: costLine(scenario.wicket_cost, data.meta.wickets_lost, scenario.ball_age, data.meta.wicket_cost_source),
      status: mode === 'loading'
        ? 'Loading the C++ engine compiled to WebAssembly. Until it is ready, this is the precomputed result.'
        : `Precomputed from ${count(data.meta.deliveries_per_estimate)} deliveries: ball age ${overs(scenario.ball_age)}, ${venue.ends[scenario.end] ?? `end ${scenario.end + 1}`}.`,
    });
  }

  // One run at a time: input during a run waits, and only the latest settings are run after it.
  const serial = latestOnly(() => (mode === 'live' ? runEngine() : showPrecomputed()));
  const scheduled = coalesce(() => serial());

  // One delivery of the batch on screen, bowled in the picture with the batter taking `action`.
  async function bowlOne(action) {
    if (mode !== 'live' || !lastRun || !active) return;
    const { args } = lastRun;
    const pick = bowlIndex(bowled, args.n, offset);
    bowled += 1;
    let delivery;
    try {
      delivery = await engine.sample({ ...args, index: pick });
    } catch (error) {
      status.textContent = `The engine did not bowl this delivery: ${error.message}.`;
      return;
    }
    if (lastRun?.args !== args || !active) return; // the settings changed while it was sampled
    const { outcome, animation } = bowledWith(action, delivery, args.length);
    const words = { action: actionLabel(action), outcome: outcomeLabel(outcome), flash: animation.flash };
    caption.clear();
    stage.setPlay(0, {
      venue: state.venue,
      arm: state.arm,
      path: delivery.path,
      bounceIndex: delivery.bounceIndex,
      color: venueColor(index()),
      onEvent: () => caption.show(words, { length: args.length }),
      onCut: (tag) => caption.setTag(tag),
    });
    stage.setOutcome(0, animation);
    stage.playTo(0, 'end');
    announce.textContent = `Delivery ${count(pick + 1)} of the batch: ${words.action.toLowerCase()}, ${words.outcome.toLowerCase()}.`;
  }

  function syncControls() {
    venueControl.set(state.venue);
    armControl.set(state.arm);
    const on = mode === 'live';
    speed.set(state.speedKmh, on && engine.limits.speedKmh, STEPS.speedKmh);
    swing.set(state.swing, on && engine.limits.swing, STEPS.swing);
    wind.set(state.crosswind, on && windRange(live, engine.limits, state.venue), STEPS.wind);
    // the precomputed scenarios were all run at the same wickets lost, so the fallback shows it, fixed
    lost.set(on ? state.wicketsLost : data.meta.wickets_lost, [0, on ? live.wicket_cost.by_wickets_lost.length - 1 : 9], 1, !on);
    lengthControl.set(state.length);
    lengthControl.disable(!on);
    bowlButtons.forEach((button) => { button.disabled = !on; });
    note.hidden = mode !== 'fallback';
    note.textContent = reason;
  }

  function change(patch) {
    state = { ...state, ...patch };
    syncControls();
    scheduled();
  }

  // Loads the engine and its settings once, the first time the view opens.
  function start() {
    const engineLoaded = nowasm ? Promise.reject(new Error('turned off by ?nowasm')) : loadEngine();
    const liveLoaded = loadLive();
    return Promise.allSettled([engineLoaded, liveLoaded]).then(([e, l]) => {
      live = l.status === 'fulfilled' ? l.value : null;
      if (e.status === 'fulfilled' && live) {
        engine = e.value;
        mode = 'live';
        buildLengths(engine.lengths);
        change({ ...standardDelivery(live, engine.limits, state.venue, state.arm), wicketsLost: data.meta.wickets_lost });
        return;
      }
      mode = 'fallback';
      reason = e.status === 'rejected' ? NO_WASM : NO_SETTINGS;
      change({});
    });
  }

  syncControls();

  return {
    el,
    activate() {
      active = true;
      stage.mount(host, [viewport]);
      stage.setCamera('stumps');
      if (!started) {
        started = start();
        showPrecomputed();
      } else if (shown) draw(shown);
    },
    deactivate() {
      active = false;
    },
  };
}

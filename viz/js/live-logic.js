// The live engine view's logic, with no DOM, so it can be tested under node.
// The engine and data/live.json are described in live.js.
import { animationFor } from './outcomes.js';

export const DELIVERIES = 50000;

export const count = (value) => Math.round(value).toLocaleString('en-GB');

const clamp = (value, [min, max]) => Math.min(Math.max(value, min), max);
const middle = ([min, max]) => (min + max) / 2;
const within = (value, range) => (Number.isFinite(value) ? clamp(value, range) : middle(range));

// The precomputed scenarios' release speed (SPEED, 37.5 m/s, in fourth_stump/export_viz.py);
// live.json leaves the speed to the visitor.
export const STANDARD_SPEED_KMH = 135;
// Slider steps; the standard delivery's values fall on them.
export const STEPS = { speedKmh: 1, swing: 0.005, wind: 0.1 };

// The crosswind a venue allows: the envelope bounds wind speed, so wind along
// the pitch (max_crosswind) narrows it. Rounded in to a whole step.
export function windRange(live, limits, venue) {
  const max = Math.floor(Math.min(limits.wind[1], -limits.wind[0], live.venues[venue]?.max_crosswind ?? Infinity) * 10) / 10;
  return [-max, max];
}

// The standard delivery at a venue for a bowler arm, for the sliders to start
// from: the release speed and the venue's own swing coefficient and crosswind.
export function standardDelivery(live, limits, venue, arm) {
  const conditions = live.venues[venue] ?? {};
  return {
    speedKmh: within(STANDARD_SPEED_KMH, limits.speedKmh),
    swing: within(conditions.swing?.[arm], limits.swing),
    crosswind: within(conditions.crosswind, windRange(live, limits, venue)),
  };
}

// Slider state to the arguments of engine.run.
export function runArgs(state, live, capacity = DELIVERIES) {
  const venue = live.venues[state.venue];
  return {
    conditions: venue.conditions,
    release: live.release[state.arm],
    speedKmh: state.speedKmh,
    swing: state.swing,
    crosswind: state.crosswind,
    wicketCost: live.wicket_cost.by_wickets_lost[state.wicketsLost],
    runsMiddled: venue.runs_middled,
    catchConversion: venue.catch_conversion,
    length: state.length ?? 'good',
    n: Math.min(DELIVERIES, capacity),
    seed: 1,
  };
}

// The engine's delivery-length presets (engine.lengths, in its order) as options for the selector.
const LENGTH_LABELS = { good: 'Good length', yorker: 'Yorker', bouncer: 'Bouncer' };
export function lengthOptions(lengths) {
  const names = Object.keys(lengths ?? { good: {} });
  return names.map((value) => ({ value, label: LENGTH_LABELS[value] ?? value }));
}

// The delivery "Leave one" or "Play one" shows on the k-th press of either: the next of the batch's
// n deliveries, starting from `offset`, so each press is a fresh delivery until the batch has all been seen.
export const bowlIndex = (k, n, offset = 0) => (offset + k) % n;

// One sampled delivery (engine.sample) with the visitor's action: its outcome in the
// fan_outcomes vocabulary, and the animation that shows it (outcomes.js) at its length.
export function bowledWith(action, delivery, length = 'good') {
  const outcome = delivery[action];
  return { action, outcome, animation: animationFor(action, outcome, length) };
}

// An engine result under the keys a scenario has in trajectories.json, so numbers.js can draw it.
export function asScenario(result, wicketCost) {
  return {
    p_wicket_leave: result.pWicketLeave,
    p_wicket_play: result.pWicketPlay,
    p_middled: result.pMiddled,
    p_edged: result.pEdged,
    p_missed: result.pMissed,
    ev_leave: result.evLeave,
    ev_play: result.evPlay,
    best: result.best,
    wicket_cost: wicketCost,
    path: result.path,
    bounce_index: result.bounceIndex,
  };
}

// Flat x, z pairs to [[x, z], ...].
export const arrivalPoints = (arrivals) =>
  Array.from({ length: Math.floor(arrivals.length / 2) }, (_, i) => [arrivals[2 * i], arrivals[2 * i + 1]]);

// The precomputed scenario for the fallback: the chosen venue and arm, the
// ball age nearest the standard delivery's, then its bowling end if there is one.
export function nearestScenario(scenarios, { venue, arm, ballAge, end }) {
  const gap = (s) => Math.abs(s.ball_age - ballAge);
  const closer = (a, b) => (gap(a) !== gap(b) ? gap(a) < gap(b) : a.end === end && b.end !== end);
  return scenarios
    .filter((s) => s.venue === venue && s.arm === arm)
    .reduce((best, s) => (best && !closer(s, best) ? best : s), undefined);
}

// The status line under a live run: what ran, how long it took, on how many workers, and the rate.
export function statusLine({ n, ms, threads = 1 }) {
  const where = 'The C++ engine compiled to WebAssembly.';
  const on = `on ${threads === 1 ? 'one worker' : `${threads} workers`}`;
  if (!(ms > 0)) return `${count(n)} deliveries ${on}, too fast for this browser's timer to measure. ${where}`;
  const time = ms.toFixed(ms < 10 ? 2 : 1);
  const rate = Number((n / (ms / 1000)).toPrecision(3));
  return `${count(n)} deliveries in ${time} ms ${on}, ${count(rate)} deliveries per second. ${where}`;
}

// Runs `run(value)` (which returns a promise and handles its own errors) one at a time: a call
// made while a run is in flight waits, and only the latest waiting value is run when it ends.
export function latestOnly(run) {
  let busy = false;
  let waiting = false;
  let latest;
  const go = (value) => {
    busy = true;
    let done;
    try {
      done = Promise.resolve(run(value));
    } catch {
      done = Promise.resolve();
    }
    done.catch(() => {}).then(() => {
      busy = false;
      if (!waiting) return;
      waiting = false;
      go(latest);
    });
  };
  return (value) => {
    if (busy) {
      waiting = true;
      latest = value;
      return;
    }
    go(value);
  };
}

// Calls run at most once per animation frame, with the last value given before that frame.
export function coalesce(run, schedule = (callback) => requestAnimationFrame(callback)) {
  let pending = false;
  let latest;
  return (value) => {
    latest = value;
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      run(latest);
    });
  };
}

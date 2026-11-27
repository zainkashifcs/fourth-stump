// Run with: node --test viz/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percent, signedRuns, lineAtStumps, heightAtStumps, outcomeLabel } from '../js/format.js';
import { addChoice, cutIndex, emptyScore, pickRound } from '../js/game-logic.js';
import { validate, findScenario, venueKeys } from '../js/data.js';
import { animationFor } from '../js/outcomes.js';
import { clapTimes, cuesFor, soundNames } from '../js/audio.js';
import { CAMERAS, RELEASE, cutAt, fovFor, shotFor } from '../js/director.js';
import {
  BODY_LIMIT, COVER, KEEPER_Y, POPPING_CREASE, STANCE_X, batterRootX, extendToKeeper, frontFoot,
} from '../js/geometry.js';
import {
  BEAT_RATES, DUCK, LINES, SWELL, beatPlan, crowdEnvelope, estimateSeconds, kindOf, lineFor, mostDramatic, pickVoice, rankVoices, speechBounds,
} from '../js/commentary.js';
import { TAKE, reactionFor, saturationCurve } from '../js/audio.js';
import { speechAllowed } from '../js/commentary.js';
import { replaySchedule } from '../js/boot.js';
import { clipTime } from '../js/models/frames.js';
import {
  DELIVERIES, STEPS, arrivalPoints, asScenario, bowlIndex, bowledWith, coalesce, latestOnly, lengthOptions, nearestScenario, runArgs,
  standardDelivery, statusLine, windRange,
} from '../js/live-logic.js';

// A stand-in for data/live.json, shaped as the real one.
const LIVE = {
  meta: { generated: '2026-11-27', ball_age: 12, bowling_end: 0 },
  release: { right: { x: 0.75, z: 2.08, line: 0 }, left: { x: -0.75, z: 2.08, line: 0 } },
  lengths: { good: { bounce_y: 6.5, from_release: 12.4 }, yorker: { bounce_y: -0.4, from_release: 19.3 }, bouncer: { bounce_y: 8.65, from_release: 10.25 } },
  venues: {
    lords: { name: "Lord's", conditions: { e_z: 0.52 }, swing: { right: 0.14, left: -0.14 }, crosswind: 1, max_crosswind: 5, catch_conversion: 0.8, runs_middled: 0.9 },
    perth: { name: 'Perth', conditions: { e_z: 0.62 }, swing: { right: 0.12 }, crosswind: 4.5, max_crosswind: 4.899, catch_conversion: 0.7, runs_middled: 0.95 },
  },
  wicket_cost: { ball_age: 12, by_wickets_lost: [40, 39, 38, 37, 36, 35, 34, 33, 32, 31] },
};
const LIMITS = { speedKmh: [120, 150], swing: [-0.3, 0.3], wind: [-5, 5] };

test('the sliders start from the standard delivery, inside the engine limits', () => {
  assert.deepEqual(standardDelivery(LIVE, LIMITS, 'lords', 'right'), { speedKmh: 135, swing: 0.14, crosswind: 1 });
  assert.equal(standardDelivery(LIVE, LIMITS, 'lords', 'left').swing, -0.14);
  // a value the file does not give starts mid-range; one outside the limits is clamped
  assert.equal(standardDelivery(LIVE, LIMITS, 'perth', 'left').swing, 0);
  assert.equal(standardDelivery(LIVE, { ...LIMITS, swing: [0, 0.1] }, 'lords', 'right').swing, 0.1);
  assert.equal(standardDelivery(LIVE, { ...LIMITS, speedKmh: [140, 150] }, 'lords', 'right').speedKmh, 140);
  // wind along the pitch narrows the crosswind allowed, rounded in to a whole step
  assert.deepEqual(windRange(LIVE, LIMITS, 'lords'), [-5, 5]);
  assert.deepEqual(windRange(LIVE, LIMITS, 'perth'), [-4.8, 4.8]);
  assert.deepEqual(windRange(LIVE, { ...LIMITS, wind: [-3, 3] }, 'perth'), [-3, 3]);
  assert.equal(standardDelivery(LIVE, LIMITS, 'perth', 'right').crosswind, 4.5);
  assert.equal(standardDelivery(LIVE, { ...LIMITS, wind: [-4, 4] }, 'perth', 'right').crosswind, 4);
  // the standard values fall on the slider steps
  const onStep = (value, min, step) => Math.abs((value - min) / step - Math.round((value - min) / step)) < 1e-9;
  assert.ok(onStep(0.14, LIMITS.swing[0], STEPS.swing) && onStep(-0.14, LIMITS.swing[0], STEPS.swing));
  assert.ok(onStep(4.5, -4.8, STEPS.wind) && onStep(135, 120, STEPS.speedKmh));
});

test('the real live.json describes the venues of trajectories.json', () => {
  const real = JSON.parse(readFileSync(new URL('../data/live.json', import.meta.url)));
  const data = JSON.parse(readFileSync(new URL('../data/trajectories.json', import.meta.url)));
  assert.deepEqual(Object.keys(real.venues), venueKeys(data));
  assert.equal(real.wicket_cost.by_wickets_lost.length, 10);
  data.arms.forEach((arm) => assert.ok(real.release[arm], arm));
  assert.ok(nearestScenario(data.scenarios, { venue: 'lords', arm: 'right', ballAge: real.meta.ball_age, end: real.meta.bowling_end }));
});

test('slider state becomes the arguments of one engine run', () => {
  const state = { venue: 'lords', arm: 'left', speedKmh: 140, swing: -0.05, crosswind: 2, wicketsLost: 3 };
  const args = runArgs(state, LIVE);
  assert.deepEqual(args, {
    conditions: LIVE.venues.lords.conditions,
    release: LIVE.release.left,
    speedKmh: 140,
    swing: -0.05,
    crosswind: 2,
    wicketCost: 37,
    runsMiddled: 0.9,
    catchConversion: 0.8,
    length: 'good',
    n: DELIVERIES,
    seed: 1,
  });
  assert.equal(runArgs({ ...state, length: 'yorker' }, LIVE).length, 'yorker');
  assert.equal(DELIVERIES, 50000);
  assert.equal(runArgs(state, LIVE, 20000).n, 20000); // never more than the engine can hold
  assert.equal(runArgs({ ...state, wicketsLost: 9 }, LIVE).wicketCost, 31);
});

test('an engine result is drawn under the same keys as a precomputed scenario', () => {
  const engine = {
    run: (args) => ({
      n: args.n, ms: 12, pWicketLeave: 0.05, pWicketPlay: 0.04, pMiddled: 0.7, pEdged: 0.26, pEdgedCarried: 0.2, pMissed: 0.04,
      evLeave: -2, evPlay: -0.8, best: 'play', arrivals: new Float64Array([0.2, 0.6, 0.25, 0.7, 0.3]), path: [[0, 18, 2], [0.2, 0, 0.6]], bounceIndex: -1,
    }),
  };
  const args = runArgs({ venue: 'perth', arm: 'right', speedKmh: 130, swing: 0, crosswind: 0, wicketsLost: 0 }, LIVE);
  const result = engine.run(args);
  const scenario = asScenario(result, args.wicketCost);
  assert.deepEqual(
    [scenario.p_wicket_leave, scenario.p_wicket_play, scenario.p_middled, scenario.p_edged, scenario.p_missed],
    [0.05, 0.04, 0.7, 0.26, 0.04],
  );
  assert.deepEqual([scenario.ev_leave, scenario.ev_play, scenario.best, scenario.wicket_cost, scenario.bounce_index], [-2, -0.8, 'play', 40, -1]);
  assert.deepEqual(arrivalPoints(result.arrivals), [[0.2, 0.6], [0.25, 0.7]]); // an odd value left over is dropped
  assert.deepEqual(arrivalPoints(new Float64Array(0)), []);
});

test('the fallback shows the precomputed scenario nearest the standard delivery', () => {
  const s = (venue, arm, ballAge, end) => ({ venue, arm, ball_age: ballAge, end });
  const scenarios = [s('lords', 'right', 1, 0), s('lords', 'right', 10, 1), s('lords', 'right', 10, 0), s('lords', 'right', 20, 0), s('lords', 'left', 10, 0), s('perth', 'right', 10, 0)];
  assert.equal(nearestScenario(scenarios, { venue: 'lords', arm: 'right', ballAge: 12, end: 0 }), scenarios[2]);
  assert.equal(nearestScenario(scenarios, { venue: 'lords', arm: 'right', ballAge: 12, end: 1 }), scenarios[1]);
  assert.equal(nearestScenario(scenarios, { venue: 'lords', arm: 'right', ballAge: 16, end: 0 }), scenarios[3]);
  assert.equal(nearestScenario(scenarios, { venue: 'lords', arm: 'left', ballAge: 80, end: 1 }), scenarios[4]); // only one there
  assert.equal(nearestScenario(scenarios, { venue: 'newlands', arm: 'right', ballAge: 1, end: 0 }), undefined);
  const data = JSON.parse(readFileSync(new URL('../data/trajectories.json', import.meta.url)));
  const picked = nearestScenario(data.scenarios, { venue: 'perth', arm: 'left', ballAge: 12, end: 0 });
  assert.deepEqual([picked.venue, picked.arm, picked.ball_age, picked.end], ['perth', 'left', 10, 0]);
});

test('the status line gives what ran, the measured time, the workers and the rate', () => {
  assert.equal(
    statusLine({ n: 50000, ms: 2.43, threads: 16 }),
    '50,000 deliveries in 2.43 ms on 16 workers, 20,600,000 deliveries per second. The C++ engine compiled to WebAssembly.',
  );
  assert.equal(statusLine({ n: 50000, ms: 41.23, threads: 1 }).slice(0, 45), '50,000 deliveries in 41.2 ms on one worker, 1');
  assert.equal(statusLine({ n: 50000, ms: 250 }).slice(0, 44), '50,000 deliveries in 250.0 ms on one worker,'); // an older result without `threads`
  // a coarse timer can read zero; never print an infinite rate
  assert.equal(statusLine({ n: 50000, ms: 0, threads: 4 }), "50,000 deliveries on 4 workers, too fast for this browser's timer to measure. The C++ engine compiled to WebAssembly.");
});

test('a run is never started while one is in flight, and only the latest request waits', async () => {
  const started = [];
  const finish = [];
  const trigger = latestOnly((value) => new Promise((resolve) => { started.push(value); finish.push(resolve); }));
  trigger(1);
  trigger(2);
  trigger(3);
  assert.deepEqual(started, [1]); // 2 and 3 wait; 2 is dropped for 3
  finish.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [1, 3]);
  finish.shift()();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [1, 3]); // nothing left to run
  trigger(4);
  assert.deepEqual(started, [1, 3, 4]);
  // a run that throws does not stop the next one
  const seen = [];
  const failing = latestOnly(async (value) => { seen.push(value); throw new Error('no'); });
  failing(1);
  failing(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [1, 2]);
});

test('"Leave one" and "Play one" bowl a delivery with that action, so every length line can be heard', () => {
  const bouncer = { leave: 'safe', play: 'middled' };
  const yorker = { leave: 'bowled', play: 'middled' };
  const left = bowledWith('leave', bouncer);
  assert.deepEqual([left.action, left.outcome, left.animation.name], ['leave', 'safe', 'left-alone']);
  assert.equal(lineFor(left.animation.name, 'bouncer').id, 'left-alone-bouncer');
  assert.equal(lineFor(bowledWith('leave', yorker).animation.name, 'yorker').id, 'bowled-yorker');
  assert.equal(lineFor(bowledWith('play', yorker).animation.name, 'yorker').id, 'middled'); // played, the same ball is middled
  assert.equal(bowledWith('play', { leave: 'safe', play: 'edged_caught' }).animation.flash, 'Caught');
});

test('each "Leave one" or "Play one" takes a fresh delivery of the batch, cycling through it', () => {
  const picks = Array.from({ length: 6 }, (_, k) => bowlIndex(k, 4, 2));
  assert.deepEqual(picks, [2, 3, 0, 1, 2, 3]);
  assert.ok(Array.from({ length: 50 }, (_, k) => bowlIndex(k, 50000, 49990)).every((i) => i >= 0 && i < 50000));
  assert.equal(new Set(Array.from({ length: 50 }, (_, k) => bowlIndex(k, 50000, 49990))).size, 50);
});

test('the length selector lists the engine\'s presets in its order, good length first', () => {
  const lengths = { good: { bounceY: 6.5 }, yorker: { bounceY: -0.4 }, bouncer: { bounceY: 8.65 } };
  assert.deepEqual(lengthOptions(lengths), [
    { value: 'good', label: 'Good length' }, { value: 'yorker', label: 'Yorker' }, { value: 'bouncer', label: 'Bouncer' },
  ]);
  assert.deepEqual(lengthOptions({ good: {}, slower: {} }), [{ value: 'good', label: 'Good length' }, { value: 'slower', label: 'slower' }]);
  assert.deepEqual(lengthOptions(undefined), [{ value: 'good', label: 'Good length' }]);
});

test('input events between two frames make one run, with the latest values', () => {
  const frames = [];
  const runs = [];
  const trigger = coalesce((value) => runs.push(value), (callback) => frames.push(callback));
  trigger(1);
  trigger(2);
  trigger(3);
  assert.equal(frames.length, 1);
  assert.deepEqual(runs, []);
  frames.shift()();
  assert.deepEqual(runs, [3]);
  trigger(4);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(runs, [3, 4]);
});

test('a front foot is legal only with its toe behind the popping crease at the bowler\'s end', () => {
  const end = { stumpsY: 20.12 };
  assert.equal(POPPING_CREASE, 1.22);
  const legal = frontFoot(19.07, end);
  assert.equal(legal.legal, true);
  assert.ok(Math.abs(legal.behind - 0.17) < 1e-9); // 17 cm behind the line, towards the bowler's stumps
  assert.equal(frontFoot(18.9, end).legal, true); // on the line still counts as behind it
  assert.equal(frontFoot(18.85, end).legal, false); // over it: a no-ball
  assert.ok(frontFoot(18.85, end).behind < 0);
  assert.equal(frontFoot(Number.NaN, end).legal, false);
});

test('a clip is only ever shown on one of its baked frames', () => {
  const step = 1 / 30;
  const onFrame = (t) => Math.abs(t / step - Math.round(t / step)) < 1e-6;
  for (let time = -0.5; time < 2; time += 0.0137) {
    const once = clipTime(time, { duration: 0.6, looping: false, step });
    assert.ok(once >= 0 && once < 0.6, `${time}: ${once}`);
    assert.ok(onFrame(once) || 0.6 - once < 1e-3, `${time}: ${once}`); // the last frame, held just inside the clip
    const loop = clipTime(time, { duration: 1.2, looping: true, step });
    assert.ok(loop >= 0 && loop < 1.2 && onFrame(loop), `${time}: ${loop}`);
  }
  assert.equal(clipTime(0.31, { duration: 0.6, looping: false, step }), 0.3);
  assert.equal(clipTime(1.24, { duration: 1.2, looping: true, step }).toFixed(4), (1 / 30).toFixed(4)); // 0.04 s in: frame 1
  assert.equal(clipTime(0.31, { duration: 0.6, looping: false, step: 0 }), 0.31); // no frame step known: unchanged
});

test('formats probabilities and expected values', () => {
  assert.equal(percent(0.05357), '5.4%');
  assert.equal(percent(0), '0.0%');
  assert.equal(percent(1), '100.0%');
  assert.equal(percent(0.0027), '0.27%');
  assert.equal(percent(0.00019), '0.02%');
  assert.equal(percent(0.00002), '0.002%');
  assert.equal(percent(0.000001), '<0.001%');
  assert.equal(percent(0.0096), '1.0%');
  assert.equal(signedRuns(-17.1752), '−17.18');
  assert.equal(signedRuns(-1.6072), '−1.61');
  assert.equal(signedRuns(0.5), '+0.50');
  assert.equal(signedRuns(-0), '0.00');
  assert.equal(signedRuns(-0.001), '0.00');
  assert.equal(lineAtStumps(0.3953, 0.1143), '28 cm outside off stump');
  assert.equal(lineAtStumps(-0.3, 0.1143), '19 cm outside leg stump');
  assert.equal(lineAtStumps(0.05, 0.1143), 'in line with the stumps');
  assert.equal(lineAtStumps(0.117, 0.1143), 'in line with the stumps');
  assert.equal(lineAtStumps(-0.117, 0.1143), 'in line with the stumps');
  assert.equal(heightAtStumps(0.6245, 0.711), '9 cm below the bails');
  assert.equal(heightAtStumps(0.714, 0.711), 'level with the bails');
  assert.equal(outcomeLabel('edged_caught'), 'Edged and caught');
  assert.equal(outcomeLabel('something_new'), 'something_new');
});

test('scores a round without mutating the previous score', () => {
  const delivery = {
    id: 7, path: [[0, 2, 1], [0, 1, 0], [0, 0, 1]], bounce_index: 1,
    outcome_leave: 'bowled', outcome_play: 'middled', ev_leave: -8, ev_play: 0.5, best: 'play',
  };
  const start = emptyScore();
  const afterLeave = addChoice(start, delivery, 'leave');
  assert.deepEqual(start, emptyScore());
  assert.deepEqual(
    { ev: afterLeave.ev, bestEv: afterLeave.bestEv, correct: afterLeave.correct, dismissals: afterLeave.dismissals },
    { ev: -8, bestEv: 0.5, correct: 0, dismissals: 1 },
  );
  const afterPlay = addChoice(afterLeave, delivery, 'play');
  assert.equal(afterPlay.ev, -7.5);
  assert.equal(afterPlay.correct, 1);
  assert.equal(afterPlay.choices.length, 2);
});

test('cuts at the bounce, or part-way when there is no bounce', () => {
  const path = Array.from({ length: 11 }, (_, i) => [0, 10 - i, 1]);
  assert.equal(cutIndex({ path, bounce_index: 4 }), 4);
  assert.equal(cutIndex({ path, bounce_index: -1 }), 6);
});

test('picks a round of distinct deliveries', () => {
  const pool = Array.from({ length: 20 }, (_, id) => ({ id }));
  const round = pickRound(pool, 6);
  assert.equal(new Set(round.map((d) => d.id)).size, 6);
  assert.equal(pickRound(pool.slice(0, 3), 6).length, 3);
  assert.equal(pool[0].id, 0);
});

test('the exported file passes validation and has every scenario', () => {
  const data = validate(JSON.parse(readFileSync(new URL('../data/trajectories.json', import.meta.url))));
  for (const venue of venueKeys(data)) {
    for (const ballAge of data.ball_ages) {
      for (const arm of data.arms) {
        assert.ok(findScenario(data, { venue, ballAge, arm, end: 0 }), `${venue} ${ballAge} ${arm}`);
      }
    }
  }
  assert.throws(() => validate({ meta: {} }), /meta\.constants/);
});

test('maps every action and outcome to its animation', () => {
  const pick = (action, outcome) => {
    const { batter, ball, flash } = animationFor(action, outcome);
    return [batter, ball, flash];
  };
  assert.deepEqual(pick('leave', 'safe'), ['leave', 'through', null]);
  assert.deepEqual(pick('leave', 'bowled'), ['leave', 'stumps', 'Bowled']);
  assert.deepEqual(pick('play', 'middled'), ['defend', 'dead', null]);
  assert.deepEqual(pick('play', 'edged_safe'), ['defend', 'edge-short', null]);
  assert.deepEqual(pick('play', 'edged_caught'), ['defend', 'edge-carry', 'Caught']);
  assert.deepEqual(pick('play', 'missed'), ['defend', 'through', null]);
  assert.deepEqual(pick('play', 'missed_bowled'), ['defend', 'stumps', 'Bowled']);
  // an outcome the page does not know still has the batter take the action
  assert.deepEqual(pick('play', 'something_new'), ['defend', 'through', null]);
  assert.deepEqual(pick('leave', undefined), ['leave', 'through', null]);
});

test('every outcome in the exported file has an animation', () => {
  const data = JSON.parse(readFileSync(new URL('../data/trajectories.json', import.meta.url)));
  const seen = new Set();
  data.game.forEach((d) => seen.add(`leave:${d.outcome_leave}`).add(`play:${d.outcome_play}`));
  data.scenarios.forEach((s) => (s.fan_outcomes ?? []).forEach((o) => seen.add(`leave:${o.leave}`).add(`play:${o.play}`)));
  seen.forEach((key) => {
    const [action, outcome] = key.split(':');
    assert.notEqual(animationFor(action, outcome).name, 'unknown', key);
  });
});

test('maps every outcome animation to its sounds', () => {
  const sounds = (name) => cuesFor(name).map((cue) => cue.sound);
  assert.deepEqual(sounds('bowled'), ['timber', 'bails', 'crowd-roar']);
  assert.deepEqual(sounds('edged-short'), ['nick', 'crowd-oooo']);
  assert.deepEqual(sounds('edged-caught'), ['nick', 'glove', 'crowd-roar']);
  assert.deepEqual(sounds('middled'), ['middled', 'crowd-applause']);
  assert.deepEqual(sounds('left-alone'), ['whoosh', 'glove', 'crowd-leave']);
  assert.deepEqual(sounds('play-and-miss'), ['whoosh', 'glove', 'crowd-oooo']);
  // the keeper takes a ball left or missed 1.4 m behind the stumps, at 13 m of path a second
  assert.ok(Math.abs(TAKE - 1.4 / 13) < 1e-12);
  ['left-alone', 'play-and-miss'].forEach((name) => assert.equal(cuesFor(name).find((cue) => cue.sound === 'glove').at, TAKE));
  // one crowd reaction for a round of three views: the most dramatic outcome's
  assert.equal(reactionFor(['middled', 'bowled', 'left-alone']), 'crowd-roar');
  assert.equal(reactionFor(['middled', 'play-and-miss', 'left-alone']), 'crowd-oooo');
  assert.equal(reactionFor(['left-alone', 'middled']), 'crowd-applause');
  assert.equal(reactionFor(['left-alone']), 'crowd-leave');
  assert.equal(reactionFor([]), null);
  assert.deepEqual(sounds('watching'), []);
  assert.deepEqual(sounds('unknown'), []);
  // the catch comes after the nick, the bails after the stump, and the whoosh before the ball arrives
  assert.ok(cuesFor('edged-caught')[1].at > cuesFor('edged-caught')[0].at);
  assert.ok(cuesFor('bowled')[1].at > 0);
  assert.ok(cuesFor('left-alone')[0].at < 0);
  // the crowd roars for a catch only once it is taken
  assert.ok(cuesFor('edged-caught')[2].at >= cuesFor('edged-caught')[1].at);
  // a ball that goes through has a 0.55 s tail (play.js); a later cue would never fire
  [...cuesFor('left-alone'), ...cuesFor('play-and-miss')].forEach((cue) => assert.ok(cue.at < 0.55, cue.sound));
});

test('applause is many separate hand claps, swelling then thinning', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const claps = clapTimes(3, 90, random);
  assert.ok(claps.length > 120 && claps.length < 240, `${claps.length} claps`);
  claps.forEach((clap, i) => {
    assert.ok(clap.at >= 0 && clap.at < 3);
    assert.ok(clap.length >= 0.006 && clap.length <= 0.018); // short bursts, not a wash of noise
    if (i > 0) assert.ok(clap.at >= claps[i - 1].at);
  });
  const inside = (from, to) => claps.filter((clap) => clap.at >= from && clap.at < to).length;
  assert.ok(inside(0.6, 1.2) > inside(0, 0.3) * 2); // builds
  assert.ok(inside(0.6, 1.2) > inside(2.6, 3) * 2); // thins out
  assert.ok(clapTimes(2, 11, random).length < clapTimes(2, 90, random).length / 4); // a pavilion ripple is sparse
});

test('the commentator has a line for every outcome and length, and speaks the most dramatic', () => {
  const pairs = [['leave', 'safe'], ['leave', 'bowled'], ['play', 'middled'], ['play', 'edged_safe'], ['play', 'edged_caught'], ['play', 'missed'], ['play', 'missed_bowled']];
  pairs.forEach(([action, outcome]) => {
    const kind = kindOf({ action, outcome: outcomeLabel(outcome) });
    assert.equal(kind, animationFor(action, outcome).name);
    ['good', 'yorker', 'bouncer', undefined].forEach((length) => assert.ok(lineFor(kind, length), `${kind} ${length}`));
  });
  assert.deepEqual(lineFor('bowled').beats, ['BOWLED HIM!', 'Right through the gate, off stump out of the ground, timber everywhere!']);
  assert.equal(lineFor('bowled').gap, 180);
  assert.equal(lineFor('bowled', 'yorker').id, 'bowled-yorker');
  assert.equal(lineFor('bowled', 'yorker').gap, 160);
  assert.equal(lineFor('bowled', 'bouncer').id, 'bowled'); // no line of its own: the good-length one
  assert.equal(lineFor('edged-caught').beats[0], 'EDGED AND GONE!');
  assert.equal(lineFor('edged-short').beats.length, 1);
  assert.equal(lineFor('left-alone').beats[0], 'Shouldered arms, judged to perfection on the fourth-stump line, watches it carry through.');
  assert.equal(lineFor('left-alone', 'bouncer').beats[0], 'Sways out of the road, sharp bumper in the corridor, well left alone.');
  assert.equal(lineFor('middled', 'yorker').id, 'middled');
  assert.equal(lineFor('play-and-miss').beats.length, 2);
  assert.equal(lineFor('unknown'), null);
  assert.equal(kindOf({ outcome: 'Play-and-miss, bowled' }), 'bowled');
  assert.equal(kindOf({ outcome: 'something new' }), null);
  assert.equal(mostDramatic(['middled', 'bowled', 'left-alone']), 'bowled');
  assert.equal(mostDramatic(['middled', 'edged-caught', 'edged-short']), 'edged-caught');
  assert.equal(mostDramatic(['middled', 'edged-short', 'play-and-miss']), 'edged-short');
  assert.equal(mostDramatic(['left-alone', 'play-and-miss', 'middled']), 'play-and-miss');
  assert.equal(mostDramatic(['left-alone', 'middled', 'left-alone']), 'middled');
  assert.equal(mostDramatic(['left-alone']), 'left-alone');
  assert.equal(mostDramatic([null, 'unknown']), null);
  assert.equal(mostDramatic([]), null);
});

test('every commentary line has its recorded clips, with the same words', () => {
  const manifest = JSON.parse(readFileSync(new URL('../assets/audio/commentary/manifest.json', import.meta.url)));
  assert.deepEqual(Object.keys(manifest.lines).sort(), Object.keys(LINES).sort());
  Object.entries(LINES).forEach(([id, line]) => {
    const clips = manifest.lines[id];
    assert.deepEqual(clips.map((clip) => clip.text), line.beats, id);
    clips.forEach((clip, index) => {
      assert.equal(clip.file, `${id}-${index + 1}.mp3`);
      const bytes = readFileSync(new URL(`../assets/audio/commentary/${clip.file}`, import.meta.url));
      assert.equal(bytes.length, clip.bytes, clip.file);
      assert.ok(bytes.length < 48 * 1024, clip.file); // a few tens of kilobytes
    });
    assert.equal(line.gap > 0, line.beats.length > 1, id); // a breath only between two beats
  });
});

test('the five crowd clips ship, compact, in Ogg', () => {
  ['crowd_roar', 'crowd_oooo', 'crowd_applause', 'crowd_leave', 'crowd_bed'].forEach((name) => {
    const bytes = readFileSync(new URL(`../assets/audio/${name}.ogg`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'OggS', name);
    assert.ok(bytes.length < 100 * 1024, `${name}: ${bytes.length} bytes`);
  });
});

test('only a view bowling on its own is spoken', () => {
  assert.equal(speechAllowed(1), true); // a replayed venue, the game, the live engine
  assert.equal(speechAllowed(3), false); // three venues at once: the tickers carry the words
  assert.equal(speechAllowed(2), false);
  assert.equal(speechAllowed(0), false);
});

test('the commentator prefers an English (UK) voice, then Australian, then any English', () => {
  const us = { name: 'US', lang: 'en-US' };
  const uk = { name: 'UK', lang: 'en-GB' };
  const au = { name: 'AU', lang: 'en-AU' };
  const fr = { name: 'FR', lang: 'fr-FR' };
  assert.equal(pickVoice([us, uk]), uk);
  assert.equal(pickVoice([us, { name: 'Android UK', lang: 'en_GB' }]).name, 'Android UK');
  assert.deepEqual(rankVoices([fr, us, au, uk]), [uk, au, us]);
  assert.equal(pickVoice([us, fr]), us);
  assert.equal(pickVoice([fr]), null); // the browser's default voice
  assert.equal(pickVoice([]), null);
});

test('the call, a breath, then the clause; the crowd ducks and swells with them', () => {
  const plan = beatPlan([0.8, 3.9], 180);
  assert.equal(plan[0].at, 0);
  assert.ok(plan[0].rate > plan[1].rate); // the call is quicker and higher
  assert.ok(Math.abs(plan[0].seconds - 0.8 / BEAT_RATES[0]) < 1e-9);
  assert.ok(Math.abs(plan[1].at - (plan[0].seconds + 0.18)) < 1e-9);
  assert.deepEqual(beatPlan([4], 0).map((b) => [b.at, b.rate]), [[0, 1]]);
  const dismissal = crowdEnvelope(plan, true);
  const quiet = crowdEnvelope(plan, false);
  assert.ok(dismissal.some(([at, gain]) => gain === SWELL && at === plan[1].at)); // swells in the breath
  assert.ok(!quiet.some(([, gain]) => gain > 1));
  [dismissal, quiet].forEach((points) => {
    assert.deepEqual(points[0], [0, 1]);
    assert.equal(points[points.length - 1][1], 1); // the crowd comes back
    assert.ok(points.some(([, gain]) => gain === DUCK));
    points.slice(1).forEach(([at], i) => assert.ok(at >= points[i][0])); // in time order
  });
  assert.ok(estimateSeconds('BOWLED HIM!') > 0.5 && estimateSeconds('BOWLED HIM!') < 1.2);
});

test('finds the speech in a decoded clip, past the encoder padding', () => {
  const rate = 1000;
  const samples = new Float32Array(1000);
  samples.fill(0.2, 100, 700);
  const { offset, seconds } = speechBounds(samples, rate, 0.003, 0.01);
  assert.ok(Math.abs(offset - 0.09) < 1e-9);
  assert.ok(Math.abs(seconds - 0.62) < 1e-9);
  assert.deepEqual(speechBounds(new Float32Array(10), rate), { offset: 0, seconds: 0 });
  assert.equal(speechBounds(Float32Array.from([0.5, 0, 0]), rate, 0.003, 0.01).offset, 0);
});

test('the microphone saturation is gentle and keeps full scale', () => {
  const curve = saturationCurve(101, 1.6);
  assert.ok(Math.abs(curve[0] + 1) < 1e-6 && Math.abs(curve[100] - 1) < 1e-6);
  assert.ok(Math.abs(curve[50]) < 1e-6);
  for (let i = 1; i < curve.length; i += 1) assert.ok(curve[i] > curve[i - 1]); // never folds back
  assert.ok(curve[60] > 0.2 && curve[60] < 0.35); // a little lift at low level, not a fuzz box
});

test('a boot replay paces its lines and lasts about three seconds', () => {
  const at = replaySchedule(4);
  assert.deepEqual(at.lines, [0, 500, 1000, 1500]);
  assert.ok(at.ready > at.lines[3]);
  assert.ok(at.wipe > at.ready);
  assert.equal(at.end - at.wipe, 420); // the CSS wipe
  assert.ok(Math.abs(at.end - 3000) <= 150, `${at.end} ms`);
});

test('every animation the page can play has sounds the synth knows', () => {
  const pairs = [['leave', 'safe'], ['leave', 'bowled'], ['play', 'middled'], ['play', 'edged_safe'], ['play', 'edged_caught'], ['play', 'missed'], ['play', 'missed_bowled']];
  pairs.forEach(([action, outcome]) => {
    const cues = cuesFor(animationFor(action, outcome).name);
    assert.ok(cues.length > 0, `${action}:${outcome}`);
    cues.forEach((cue) => assert.ok(soundNames.includes(cue.sound), cue.sound));
  });
  assert.ok(soundNames.includes('bounce') && soundNames.includes('chime'));
});

test('cuts between the three cameras at the right moments', () => {
  assert.deepEqual(cutAt(0), { id: 1, tag: 'CAM 1 // MARK', camera: 'stumps', punchIn: false });
  assert.equal(cutAt(0.79).id, 1);
  assert.deepEqual(cutAt(0.8), { id: 2, tag: 'CAM 2 // CREASE', camera: 'stumps', punchIn: false });
  assert.equal(cutAt(RELEASE - 0.001).id, 2);
  assert.deepEqual(cutAt(RELEASE), { id: 3, tag: 'CAM 3 // STUMP CAM', camera: 'stumps', punchIn: false });
  assert.equal(RELEASE, 1.35);
  // cut 3 lands on the preset the visitor chose
  assert.equal(cutAt(RELEASE, { camera: 'side' }).tag, 'CAM 3 // SIDE ON');
  assert.equal(cutAt(RELEASE, { camera: 'above' }).tag, 'CAM 3 // FROM ABOVE');
  assert.equal(cutAt(0.9, { camera: 'side' }).tag, 'CAM 2 // CREASE');
  assert.equal(cutAt(RELEASE, { camera: 'nonsense' }).tag, 'CAM 3 // STUMP CAM');
  // the close-up waits for the ball to arrive, and for an outcome to be known
  assert.equal(cutAt(2.5, { eventTime: 2.8 }).punchIn, false);
  assert.equal(cutAt(2.8, { eventTime: 2.8 }).punchIn, true);
  assert.equal(cutAt(9).punchIn, false);
  assert.equal(cutAt(0.5, { eventTime: 0.1 }).punchIn, false);
  // a ball left alone or missed has nothing to close in on: the wide frame follows it to the keeper
  assert.equal(cutAt(2.8, { eventTime: 2.8, through: true }).punchIn, false);
  // the side-on and from-above presets hold their wide frame
  assert.equal(cutAt(2.8, { eventTime: 2.8, camera: 'side' }).punchIn, false);
  assert.equal(cutAt(2.8, { eventTime: 2.8, camera: 'above' }).punchIn, false);
});

test('puts each camera where its cut says', () => {
  const home = CAMERAS.stumps;
  const scene = { side: 1, pitchLength: 20.12, ball: [0.3, 8, 1], impact: [0.3, 1.22, 0.6] };
  const mark = shotFor(cutAt(0), { ...scene, time: 0 });
  assert.equal(mark.position[1], 20.12 + 11); // 11 m behind the bowling crease
  assert.ok(shotFor(cutAt(0.7), { ...scene, time: 0.7 }).position[1] < mark.position[1]); // tracking in
  const crease = shotFor(cutAt(1), { ...scene, time: 1 });
  assert.deepEqual([Math.abs(crease.position[0]), crease.position[1]], [3.5, 20.12 - 1.5]);
  assert.equal(shotFor(cutAt(1), { ...scene, time: 1, side: -1 }).position[0], -crease.position[0]); // mirrored for a left-armer
  const live = shotFor(cutAt(2), { ...scene, time: 2 });
  assert.deepEqual(live.position, home.position);
  assert.ok(live.target[1] > home.target[1]); // leaning towards the ball
  assert.equal(live.fov, null);
  ['side', 'above'].forEach((camera) => {
    const shot = shotFor(cutAt(2, { camera }), { ...scene, time: 2 });
    assert.deepEqual([shot.position, shot.target, shot.fov], [CAMERAS[camera].position, CAMERAS[camera].target, null]);
  });
  const close = shotFor(cutAt(3, { eventTime: 2.9 }), { ...scene, time: 3 });
  assert.ok(close.position[1] > home.position[1] && close.target[1] === 1.22); // punched in on the bat
});

// Where a data point lands in a preset's picture: [-1, 1] on both axes is inside the frame.
function inPicture({ position, target, minHorizontalFov }, aspect, point) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const unit = (a) => a.map((v) => v / Math.hypot(...a));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const forward = unit(sub(target, position));
  const right = unit(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  const d = sub(point, position);
  if (dot(d, forward) <= 0) return [Infinity, Infinity]; // behind the camera
  const tanHalf = Math.tan((fovFor(aspect, minHorizontalFov) * Math.PI) / 360);
  return [dot(d, right) / dot(d, forward) / (tanHalf * aspect), dot(d, up) / dot(d, forward) / tanHalf];
}
const inside = (xy) => xy.every((v) => Math.abs(v) < 1);
const ASPECTS = [0.8, 0.9, 1.4, 2, 2.4]; // venue columns, the game view, a phone held either way

test('every camera preset frames the release, the bowler, the batter and the keeper plane', () => {
  const bowler = [-1.2, 1.2].flatMap((x) => [[x, 19.8, 0], [x, 18.4, 2.3]]); // both arms, from feet to raised hand
  const keep = [[0.45, 18.9, 2.1], [-0.45, 18.9, 2.1], ...bowler, [0, 0, 0], [0.3, KEEPER_Y, 0.6], [-0.9, 1.22, 1.9], [-0.9, 1.22, 0]];
  Object.entries(CAMERAS).forEach(([name, preset]) => ASPECTS.forEach((aspect) => keep.forEach((point) => {
    assert.ok(inside(inPicture(preset, aspect, point)), `${name} at ${aspect}: ${point}`);
  })));
  // the bowler stays below the camera tag along the top, and the batter and the top of the
  // wicket above the captions, which take the bottom fifth or so
  Object.entries(CAMERAS).forEach(([name, preset]) => ASPECTS.forEach((aspect) => {
    keep.slice(0, 6).forEach((point) => {
      assert.ok(inPicture(preset, aspect, point)[1] < 0.75, `${name} at ${aspect}: ${point}`);
    });
    [[-0.9, 1.22, 1.9], [-0.9, 1.22, 0], [0, 0, 0.71]].forEach((point) => {
      assert.ok(inPicture(preset, aspect, point)[1] > -0.55, `${name} at ${aspect}: ${point}`);
    });
  }));
});

test('the close-up keeps the whole batter, head included, and the wicket above the captions', () => {
  const scene = { side: 1, pitchLength: 20.12, ball: null };
  [[0.05, 0, 0.3], [0.3, 1.22, 0.6]].forEach((impact) => {
    const shot = shotFor(cutAt(3, { eventTime: 2.9 }), { ...scene, time: 3, impact });
    assert.equal(shot.fov, 34); // the preset lens, so the picture test below holds as written
    ASPECTS.forEach((aspect) => {
      [[-0.75, 1.22, 1.95], [-0.25, 1.22, 1.95], [-0.48, 1.22, 0]].forEach((point) => {
        const [x, y] = inPicture(shot, aspect, point);
        assert.ok(Math.abs(x) < 1 && y < 0.92 && y > -0.7, `${impact} at ${aspect}: batter ${point} at ${x.toFixed(2)}, ${y.toFixed(2)}`);
      });
      [[0.11, 0, 0.71], [-0.11, 0, 0.71]].forEach((point) => {
        const [x, y] = inPicture(shot, aspect, point);
        assert.ok(Math.abs(x) < 1 && y > -0.7, `${impact} at ${aspect}: wicket ${point} at ${x.toFixed(2)}, ${y.toFixed(2)}`);
      });
    });
  });
});

test('the cover fielder is out of the behind-the-stumps frame and in the other two', () => {
  const [x, y] = COVER;
  const body = [[x, y, 0], [x, y, 1.3], [x - 0.5, y, 0.6], [x + 0.5, y, 0.6]];
  ASPECTS.forEach((aspect) => body.forEach((point) => {
    assert.ok(!inside(inPicture(CAMERAS.stumps, aspect, point)), `stumps at ${aspect}`);
    assert.ok(inside(inPicture(CAMERAS.side, aspect, point)), `side at ${aspect}`);
    assert.ok(inside(inPicture(CAMERAS.above, aspect, point)), `above at ${aspect}`);
  }));
  assert.equal(fovFor(0.9), 34);
  assert.ok(fovFor(0.5) > 34); // a narrow view widens its lens
  assert.ok(fovFor(0.9, CAMERAS.side.minHorizontalFov) > 34);
});

test('from above also takes in the rope, the boards and the front of the stands', () => {
  // stadium.glb: rope 65 m, boards 67 m and stands from 72 m out from the middle of the pitch,
  // open for the venue's backdrop for 19 degrees either side of straight behind the bowler
  const middle = 20.12 / 2;
  const ring = (radius, z) => Array.from({ length: 360 }, (_, deg) => deg)
    .filter((deg) => Math.abs(((deg + 180) % 360) - 180) > 19)
    .map((deg) => [radius * Math.sin((deg * Math.PI) / 180), middle + radius * Math.cos((deg * Math.PI) / 180), z]);
  [['rope', ring(65, 0.1)], ['boards', ring(67, 0.5)], ['stands', ring(72, 1.5)]].forEach(([name, points]) => ASPECTS.forEach((aspect) => {
    const seen = points.filter((point) => inside(inPicture(CAMERAS.above, aspect, point)));
    assert.ok(seen.length >= 8, `${name} at ${aspect}: ${seen.length} degrees of it in frame`);
  }));
});

test('the batter stands on the leg side and never lets a corridor delivery through his body', () => {
  const corridor = [0.18, 0.2, 0.23, 0.25, 0.28];
  const bats = [0, -0.07, -0.16, 0.17]; // middled, edged, missed, bowled through the gap (outcomes.js)
  const files = [{}, { batLine: 0.6, bodyEdge: 0.25 }, { batLine: 0.8, bodyEdge: 0.1 }, { batLine: 0.7, bodyEdge: 0 }];
  corridor.forEach((ballX) => bats.forEach((bat) => files.forEach((file) => ['leave', 'play'].forEach((action) => {
    const edge = batterRootX(action, ballX + bat, file) + (file.bodyEdge ?? 0.25);
    assert.ok(edge <= BODY_LIMIT + 1e-9, `${action} ${ballX} ${bat} ${JSON.stringify(file)}: ${edge}`);
  }))));
  assert.equal(STANCE_X, -0.48);
  assert.equal(batterRootX('leave', 0.25), STANCE_X);
  assert.ok(Math.abs(batterRootX('play', 0.23) + 0.7 - 0.23) < 1e-9); // the bat face meets the line
  assert.equal(batterRootX('play', 0.6), BODY_LIMIT - 0.25); // a wide one is not chased into the line
  assert.ok(batterRootX('play', -2) >= -0.9); // nor one far down the leg side
});

test('a leave steps further to the leg side when the ball would pass through the body', () => {
  const reach = { batLine: 0.7, bodyEdge: 0.234, ballRadius: 0.036 };
  for (let ballX = -1.2; ballX <= 0.8; ballX += 0.01) {
    const root = batterRootX('leave', ballX, reach);
    const misses = ballX - reach.ballRadius >= root + reach.bodyEdge - 1e-9 || ballX + reach.ballRadius <= root - reach.bodyEdge + 1e-9;
    assert.ok(misses, `${ballX.toFixed(2)}: root ${root}`);
    assert.ok(root <= STANCE_X, `${ballX.toFixed(2)}: never steps towards the off side`);
  }
  assert.equal(batterRootX('leave', 0.2, reach), STANCE_X); // a corridor ball keeps the stance
  assert.equal(batterRootX('leave', -1, reach), STANCE_X); // so does one well clear down the leg side
  assert.ok(Math.abs(batterRootX('leave', -0.3, reach) - (-0.3 - 0.036 - 0.234)) < 1e-9); // just far enough to miss
});

test('a delivery left or missed runs on, with gravity, to the keeper plane', () => {
  const path = [[0.4, 1.2, 0.5], [0.41, 0.8, 0.55], [0.42, 0.4, 0.6], [0.43, 0, 0.65]];
  const copy = structuredClone(path);
  const longer = extendToKeeper(path);
  assert.deepEqual(path, copy); // the data is left alone
  assert.deepEqual(longer.slice(0, path.length), path);
  assert.equal(longer.at(-1)[1], KEEPER_Y);
  assert.equal(longer.length, path.length + 4);
  longer.slice(path.length).forEach(([x, y, z], i) => {
    const along = -y / 0.4; // the last segment carried on in a straight line
    assert.ok(Math.abs(x - (0.43 + 0.01 * along)) < 1e-9);
    const drop = 0.65 + 0.05 * along - z;
    assert.ok(drop > 0 && drop < 0.02, `${i}: ${drop}`); // gravity bends it down, a little
    assert.ok(y < longer[path.length + i - 1][1]);
  });
  assert.equal(extendToKeeper([[0, 1, 0.1], [0, 0, 0.01]], { floor: 0.036 }).at(-1)[2], 0.036); // not into the turf
  const passed = [[0, 0, 1], [0, -2, 1]];
  assert.equal(extendToKeeper(passed), passed);
});

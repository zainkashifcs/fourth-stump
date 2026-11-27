// Run with: node --test viz/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HEAD_CLEAR, LIFT, LOOK_LIMITS, MISS, SLIDE, STEER_BEFORE, SWING, alongBlade, contactTarget, legSlack, lookTurn, planContact, reachScale,
  rotate, segmentDistance, steer, steerWeight, twoBone,
} from '../js/contact.js';

test('the bat swings about the top hand clear of the head, and the body bends within reason', () => {
  assert.ok(close(rotate([1, 0, 0], [0, 0, 1], Math.PI / 2), [0, 1, 0], 1e-12));
  assert.equal(segmentDistance([0, 1, 0], [-1, 0, 0], [1, 0, 0]), 1);
  assert.equal(segmentDistance([2, 0, 0], [-1, 0, 0], [1, 0, 0]), 1); // past the end, to the end point
  assert.equal(legSlack([0, 0.86, 0], [0, 0, 0], 0.86), 0); // a straight leg cannot rise
  assert.ok(Math.abs(legSlack([0, 0.8, 0], [0, 0, 0], 0.86) - 0.06) < 1e-12);
  assert.ok(Math.abs(legSlack([0.3, 0.7, 0], [0, 0, 0], 0.86) - (Math.sqrt(0.86 ** 2 - 0.09) - 0.7)) < 1e-12);
  // a wide ball: the blade angles out to it, the bottom hand still in reach and the head clear
  const pose = {
    middle: [0.67, 0.52, -1.26], out: [0, 0, -1], axis: [0, -0.88, 0.48], toe: [0.67, 0.29, -1.1], head: [0.07, 1.42, -1.65], top: 0, rise: 0,
    grips: [[0.67, 0.99, -1.5], [0.67, 0.88, -1.44]], shoulders: [[0.05, 1.09, -1.77], [0.08, 1.22, -1.36]], reaches: [0.689, 0.689],
  };
  const wide = planContact({ impact: [0.78, 0.45, -1.3], kind: 'face', radius: 0.036, rootX: -0.381, bodyEdge: 0.231, pose });
  assert.ok(wide.swing.angle > 0 && wide.swing.angle <= SWING);
  const moved = (p) => [p[0] + wide.root[0], p[1] + wide.lift, p[2] + wide.root[1]]; // the body's shift comes first
  const turned = (p) => wide.swing.pivot.map((v, i) => v + rotate(moved(p).map((g, j) => g - wide.swing.pivot[j]), wide.swing.axis, wide.swing.angle)[i]);
  assert.ok(dist(turned(pose.grips[1]), moved(pose.shoulders[1])) <= 0.689 + 1e-9);
  assert.ok(segmentDistance(moved(pose.head), wide.swing.pivot, turned(pose.toe)) >= HEAD_CLEAR - 1e-9);
  // a low ball: the knees bend, within LIFT
  const low = planContact({ impact: [0.29, 0.3, -1.3], kind: 'face', radius: 0.036, rootX: -0.381, bodyEdge: 0.231, pose });
  assert.ok(low.lift < 0 && low.lift >= -LIFT.down);
});
import { batterRootX } from '../js/geometry.js';
import { CLIP_FALLBACKS, WATCHING, animationFor, batterClips } from '../js/outcomes.js';
import {
  BODY_LIMIT, FOLLOW, KEEPER_RISE, KEEPER_STEP, ROOT_STEP, STEER_LEG, followThrough, keeperReach, rootStep,
} from '../js/geometry.js';
import { SHAKE, cutAt, shakeOffset, showsKeeper } from '../js/director.js';

test('after the release the bowler carries on two slowing strides and peels off the pitch', () => {
  const at = (s, arm) => followThrough(s, arm);
  assert.ok(at(0).every((v) => v === 0)); // nothing at the release (-0 counts)
  assert.ok(at(-1).every((v) => v === 0));
  const steps = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((s) => at(s));
  steps.slice(1).forEach(([, y], i) => assert.ok(y < steps[i][1])); // always on down the pitch (data -y)
  const strides = steps.slice(1).map(([, y], i) => steps[i][1] - y);
  strides.slice(1).forEach((d, i) => assert.ok(d < strides[i])); // slowing
  assert.ok(Math.abs(at(FOLLOW.seconds)[1] + FOLLOW.carry) < 1e-12);
  assert.deepEqual(at(5), at(FOLLOW.seconds)); // then stops
  // a right-armer over the wicket delivers from x = +0.97 and finishes off the pitch (half-width 1.525 m) on the off side
  assert.ok(0.97 + at(FOLLOW.seconds, 'right')[0] > 1.525);
  assert.ok(-0.97 + at(FOLLOW.seconds, 'left')[0] < -1.525); // his mirror
});

test('the batter shifts onto the ball only within the body rule and a short step', () => {
  const edge = 0.223;
  const free = rootStep(-0.6, [0.1, 0.05], { bodyEdge: edge });
  assert.ok(Math.abs(free[0] - 0.1) < 1e-12 && free[1] === 0.05);
  const [across] = rootStep(-0.4, [0.3, 0], { bodyEdge: edge }); // the body rule stops him at -0.15 - 0.223
  assert.ok(Math.abs(-0.4 + across - (BODY_LIMIT - edge)) < 1e-12);
  assert.equal(rootStep(-1.1, [-0.3, 0], { bodyEdge: edge })[0] + -1.1, STEER_LEG); // and the leg-side bound
  assert.equal(rootStep(-0.6, [0, 0.5])[1], ROOT_STEP);
  assert.equal(rootStep(-0.6, [0, -0.5])[1], -ROOT_STEP);
  for (let x = -1.3; x <= 0.8; x += 0.05) {
    for (const rootX of [-1.0, -0.7, -0.48, BODY_LIMIT - edge]) {
      const body = rootX + rootStep(rootX, [x, 0], { bodyEdge: edge })[0] + edge;
      assert.ok(body <= BODY_LIMIT + 1e-9, `${rootX} ${x}: body at ${body}`); // never inside -0.15
    }
  }
});

test('the keeper steps across and rises to the ball within a short step, arms doing the rest', () => {
  assert.deepEqual(keeperReach([0.4, 0.8, 1.4], [0.25, 0.6, 1.4]), { step: 0.4 - 0.25, rise: 0.8 - 0.6 });
  assert.equal(keeperReach([2, 0.6, 1.4], [0.25, 0.6, 1.4]).step, KEEPER_STEP);
  assert.equal(keeperReach([-2, 0.6, 1.4], [0.25, 0.6, 1.4]).step, -KEEPER_STEP);
  assert.equal(keeperReach([0.25, 3, 1.4], [0.25, 0.6, 1.4]).rise, KEEPER_RISE[1]);
  assert.equal(keeperReach([0.25, 0, 1.4], [0.25, 0.6, 1.4]).rise, KEEPER_RISE[0]);
});

test('the keeper is left out of the behind-the-stumps camera only', () => {
  assert.equal(showsKeeper('stumps'), false);
  assert.equal(showsKeeper('side'), true);
  assert.equal(showsKeeper('above'), true);
  assert.equal(showsKeeper('stumps', cutAt(0)), true); // behind the bowler's mark, looking down the pitch
  assert.equal(showsKeeper('stumps', cutAt(1)), true); // side-on at the crease
  assert.equal(showsKeeper('stumps', cutAt(2)), false); // the stump camera
  assert.equal(showsKeeper('stumps', cutAt(3, { eventTime: 2.9 })), false); // and its close-up
  assert.equal(showsKeeper('side', cutAt(2, { camera: 'side' })), true);
});

test('the camera jolts for 25 ms as the stumps are hit, then is still', () => {
  assert.equal(shakeOffset(null), null);
  assert.equal(shakeOffset(-0.01), null);
  assert.equal(shakeOffset(SHAKE.seconds), null);
  assert.equal(SHAKE.seconds, 0.025);
  const first = shakeOffset(0);
  assert.ok(Math.hypot(...first) > 0 && Math.hypot(...first) <= SHAKE.size + 1e-12);
  assert.ok(Math.hypot(...shakeOffset(0.02)) < Math.hypot(...first)); // dying away
});

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const close = (a, b, tolerance = 1e-9) => dist(a, b) <= tolerance;

// The batter's bat and arms at the contact frame of Forward_Defensive ('face', 'miss', 'gate')
// and Edge_Flash ('edge'), relative to his root, scene axes; read from batter.glb (27 November
// 2026, bat_line 0.67, body_edge 0.231) with batter.contactPose(kind) in the page. Read it again
// when the model changes; the page itself always reads the model it loads.
const FD_BODY = { toe: [0.67, 0.29236, 0.11461], head: [0.0693, 1.42116, -0.43167], top: 0, rise: 0 };
const POSE = {
  contactY: 1.22897,
  face: { ...FD_BODY, middle: [0.67, 0.52425, -0.04497], out: [0, -0.02778, -0.05091], axis: [0, -0.87781, 0.47902], grips: [[0.67, 0.98933, -0.27826], [0.67, 0.87522, -0.21599]], shoulders: [[0.04953, 1.094, -0.54808], [0.08323, 1.21918, -0.13808]], reaches: [0.689, 0.689] },
  edge: {
    toe: [0.62308, 0.27428, 0.06979], head: [0.05781, 1.47844, -0.32395], top: 0, rise: 0,
    middle: [0.67552, 0.53656, -0.02906], out: [0.10488, 0.01019, 0.02367], axis: [0, -0.91854, 0.39532], grips: [[0.6257, 1.00489, -0.25628], [0.6257, 0.88548, -0.20489]], shoulders: [[0.03592, 1.16235, -0.46134], [0.08144, 1.25622, -0.04419]], reaches: [0.689, 0.689],
  },
  miss: { ...FD_BODY, middle: [0.724, 0.53814, -0.01952], out: [0.108, 0, 0], axis: [0, -0.87781, 0.47902], grips: [[0.67, 0.98933, -0.27826], [0.67, 0.87522, -0.21599]], shoulders: [[0.04953, 1.094, -0.54808], [0.08323, 1.21918, -0.13808]], reaches: [0.689, 0.689] },
};
const REACH = { batLine: 0.67, bodyEdge: 0.231 };

// The ball's [x, height] where the path crosses data y = planeY.
function crossing(path, planeY) {
  for (let i = 1; i < path.length; i += 1) {
    if (path[i][1] <= planeY) {
      const [a, b] = [path[i - 1], path[i]];
      const t = (a[1] - planeY) / (a[1] - b[1]);
      return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return null;
}

// One delivery played to an outcome, as the page plays it: the batter placed for the line
// (geometry.js), the bat steered onto the ball at impact (planContact).
function contactFor(path, outcome) {
  const animation = animationFor('play', outcome);
  const [x, height] = crossing(path, POSE.contactY);
  const rootX = batterRootX('play', x + animation.bat, REACH);
  const fixture = POSE[animation.contact === 'gate' ? 'miss' : animation.contact];
  const at = (p) => [p[0] + rootX, p[1], p[2] - 1.22]; // the root stands on the bat plane
  const pose = {
    ...fixture, middle: at(fixture.middle), toe: at(fixture.toe), head: at(fixture.head), grips: fixture.grips.map(at), shoulders: fixture.shoulders.map(at),
  };
  return {
    x, height,
    ...planContact({ impact: [x, height, -POSE.contactY], kind: animation.contact, radius: 0.036, rootX, bodyEdge: REACH.bodyEdge, pose }),
  };
}

test('every delivery in the data file is met within a millimetre, or the reach limit is reported', () => {
  const data = JSON.parse(readFileSync(new URL('../data/trajectories.json', import.meta.url)));
  const rows = [
    ...data.scenarios.flatMap((s) => ['middled', 'edged_safe', 'edged_caught', 'missed'].map((o) => contactFor(s.path, o))),
    ...data.game.filter((d) => ['middled', 'edged_safe', 'edged_caught', 'missed'].includes(d.outcome_play)).map((d) => contactFor(d.path, d.outcome_play)),
  ];
  assert.ok(rows.length > 400, `${rows.length}`);
  rows.forEach((r) => assert.ok(r.error <= 1e-3 || r.limited, `${r.x}, ${r.height}: ${r.error} m and not reported`));
  // what is left unreached is a line too wide outside off stump for a batter held by the body rule
  rows.filter((r) => r.limited).forEach((r) => assert.ok(r.x > 0.3, `${r.x}, ${r.height}: limited inside the reach of a wide-angled bat`));
  rows.forEach((r) => {
    assert.ok(r.swing.angle <= SWING + 1e-12 && r.lift >= -LIFT.down - 1e-12 && r.lift <= LIFT.up + 1e-12);
    assert.ok(r.lift <= 0, 'never up on the toes when the legs are straight (rise 0)');
  });
  // a ball in the fourth-stump corridor at a defending height is always met exactly
  const corridor = rows.filter((r) => r.x >= 0.18 && r.x <= 0.28 && r.height >= 0.45 && r.height <= 0.7);
  assert.ok(corridor.length > 20, `${corridor.length}`);
  corridor.forEach((r) => assert.ok(!r.limited && r.error <= 1e-3, `${r.x}, ${r.height}: ${r.error}`));
});

test('the steer comes in over the last 0.14 s, is whole at impact, and is let go after', () => {
  assert.equal(steerWeight(-1), 0);
  assert.equal(steerWeight(-STEER_BEFORE), 0);
  assert.ok(steerWeight(-STEER_BEFORE / 2) > 0.4 && steerWeight(-STEER_BEFORE / 2) < 0.6);
  assert.equal(steerWeight(0), 1);
  assert.ok(steerWeight(0.1) < 1 && steerWeight(0.1) > 0);
  assert.equal(steerWeight(1), 0);
  assert.equal(steerWeight(Number.NaN), 0);
  for (let s = -0.2; s < 0; s += 0.01) assert.ok(steerWeight(s) <= steerWeight(s + 0.01) + 1e-12); // never backs off before impact
});

test('the bat\'s reference point goes to the ball: face and edge touch it, a miss is well inside', () => {
  const ball = [0.25, 1.22, 0.4];
  const r = 0.036;
  assert.ok(close(contactTarget(ball, 'face', [0, 1, 0], { radius: r }), [0.25, 1.22 - r, 0.4])); // the ball sits on the face
  assert.ok(close(contactTarget(ball, 'edge', [2, 0, 0], { radius: r }), [0.25 - r, 1.22, 0.4])); // against the outside edge
  const miss = contactTarget(ball, 'miss', [1, 0, 0], { radius: r });
  assert.ok(ball[0] - miss[0] >= 0.06 && ball[0] - miss[0] <= 0.10); // 6 to 10 cm inside the line
  assert.ok(Math.abs(ball[0] - miss[0] - MISS) < 1e-12);
  assert.ok(close(contactTarget(ball, 'gate', [-1, 0, 0], { radius: r }), [0.25 + MISS, 1.22, 0.4])); // inside edge outside the line
});

test('the ball is met within the middle third of the blade, nearest where it arrives', () => {
  const middle = [0.3, 0.5, 1.2];
  const axis = [0, -1, 0]; // down the blade
  assert.ok(close(alongBlade(middle, axis, [0.3, 0.45, 1.2]), [0.3, 0.45, 1.2])); // 5 cm lower on the face
  assert.ok(close(alongBlade(middle, axis, [0.35, 0.2, 1.2]), [0.3, 0.5 - SLIDE, 1.2])); // no lower than the middle third
  assert.ok(close(alongBlade(middle, axis, [0.3, 0.9, 1.2]), [0.3, 0.5 + SLIDE, 1.2]));
  assert.ok(SLIDE * 2 <= 0.56 / 3 + 1e-9); // within the middle third of a 56 cm blade
});

test('the bat moves only as far as both hands, carried with it, stay in reach', () => {
  const shoulders = [[0, 0, 0], [0.4, 0, 0]];
  const reaches = [0.7, 0.7];
  const grips = [[0.5, 0, 0], [0.5, -0.1, 0]];
  assert.equal(reachScale(grips, [0.1, 0, 0], shoulders, reaches), 1);
  const s = reachScale(grips, [0.4, 0, 0], shoulders, reaches); // the first hand reaches 0.7 at s = 0.5
  assert.ok(Math.abs(s - 0.5) < 1e-9, `${s}`);
  assert.equal(reachScale(grips, [0, 0, 0], shoulders, reaches), 1);
  // already out of reach and moving further away: stays put
  assert.equal(reachScale([[1, 0, 0], [1, 0, 0]], [0.5, 0, 0], [[0, 0, 0], [0, 0, 0]], [0.7, 0.7]), 0);
  // out of reach but moving back in: goes all the way
  assert.equal(reachScale([[1, 0, 0], [1, 0, 0]], [-0.5, 0, 0], [[0, 0, 0], [0, 0, 0]], [0.7, 0.7]), 1);

  const free = steer({ target: [0.55, 0, 0.1], ref: [0.5, 0, 0], grips, shoulders, reaches });
  assert.equal(free.limited, false);
  assert.ok(free.error < 1e-12);
  const far = steer({ target: [1.5, 0, 0], ref: [0.5, 0, 0], grips, shoulders, reaches });
  assert.equal(far.limited, true);
  assert.ok(Math.abs(far.error - 0.8) < 1e-9); // stops 0.2 m on, 0.8 m short, with the first hand at full reach
  const half = steer({ target: [0.6, 0, 0], ref: [0.5, 0, 0], grips, shoulders, reaches, weight: 0.5 });
  assert.ok(close(half.delta, [0.05, 0, 0]));
});

test('two-bone reach puts the hand on the target with the elbow towards the pole', () => {
  const shoulder = [0, 1.4, 0];
  const pole = [0, 1, -1];
  const { elbow, hand, reached } = twoBone(shoulder, [0.4, 1.0, 0.3], 0.34, 0.35, pole);
  assert.equal(reached, true);
  assert.ok(close(hand, [0.4, 1.0, 0.3]));
  assert.ok(Math.abs(dist(shoulder, elbow) - 0.34) < 1e-9 && Math.abs(dist(elbow, hand) - 0.35) < 1e-9);
  // bent towards the pole: the elbow lies off the shoulder-hand line on the pole's side
  const target = [0.4, 1.0, 0.3];
  const line = target.map((v, i) => v - shoulder[i]);
  const along = line.map((v) => v / Math.hypot(...line));
  const offLine = (p) => {
    const rel = p.map((v, i) => v - shoulder[i]);
    const k = rel.reduce((s, v, i) => s + v * along[i], 0);
    return rel.map((v, i) => v - k * along[i]);
  };
  assert.ok(offLine(elbow).reduce((s, v, i) => s + v * offLine(pole)[i], 0) > 0);
  const straight = twoBone(shoulder, [2, 1.4, 0], 0.34, 0.35, pole);
  assert.equal(straight.reached, false);
  assert.ok(close(straight.hand, [0.69, 1.4, 0], 1e-6)); // a straight arm pointing at it
  const folded = twoBone(shoulder, shoulder, 0.34, 0.35, pole); // never a NaN
  assert.ok([...folded.elbow, ...folded.hand].every(Number.isFinite));
});

test('the head turns towards the ball, clamped clear of the arms and the bat', () => {
  const ahead = [0, 0, -1]; // the clip's head looks up the pitch
  const small = lookTurn(ahead, [0.3, 0, -1]);
  assert.ok(small.yaw < 0 && small.yaw > -LOOK_LIMITS.yaw); // turns towards +x, not clamped
  assert.ok(Math.abs(small.pitch) < 1e-9);
  const behind = lookTurn(ahead, [0.5, -0.2, 1]); // the ball gone past, into the keeper's gloves
  assert.equal(Math.abs(behind.yaw), LOOK_LIMITS.yaw);
  assert.ok(behind.pitch < 0 && behind.pitch >= -LOOK_LIMITS.down);
  assert.equal(lookTurn(ahead, [0, -5, -1]).pitch, -LOOK_LIMITS.down);
  assert.equal(lookTurn(ahead, [0, 5, -1]).pitch, LOOK_LIMITS.up);
  assert.deepEqual(lookTurn(ahead, ahead), { yaw: 0, pitch: 0 });
});

test('every outcome has its own clips, and each falls back to today\'s when a clip is missing', () => {
  const clips = (action, outcome, length) => animationFor(action, outcome, length).clips;
  assert.deepEqual(clips('leave', 'safe'), ['Leave_Shoulder_Arms']);
  assert.deepEqual(clips('leave', 'safe', 'bouncer'), ['Leave_Duck_Sway']);
  assert.deepEqual(clips('play', 'middled'), ['Forward_Defensive', 'Follow_Through']);
  assert.deepEqual(clips('play', 'edged_safe'), ['Edge_Flash']);
  assert.deepEqual(clips('play', 'edged_caught'), ['Edge_Flash', 'Head_Drop']);
  assert.deepEqual(clips('leave', 'bowled'), ['Leave_Shoulder_Arms', 'Bowled_After_Leave']);
  assert.deepEqual(clips('play', 'missed_bowled'), ['Forward_Defensive', 'Bowled_After_Play']);
  assert.deepEqual(clips('play', 'missed'), ['Forward_Defensive']);
  // the names the sounds are keyed on never change with the length
  assert.equal(animationFor('leave', 'safe', 'bouncer').name, 'left-alone');
  assert.equal(animationFor('leave', 'bowled', 'yorker').name, 'bowled');
  assert.equal(animationFor('leave', 'bowled').then, 'event'); // the look back starts as the stumps break
  assert.equal(animationFor('play', 'middled').then, 'end');
  assert.deepEqual(
    ['middled', 'edged_safe', 'edged_caught', 'missed', 'missed_bowled'].map((o) => animationFor('play', o).contact),
    ['face', 'edge', 'edge', 'miss', 'gate'],
  );
  assert.equal(animationFor('leave', 'safe').contact, null);

  const all = () => true;
  const today = (name) => ['Forward_Defensive', 'Leave_Shoulder_Arms', 'Edge_Flash', 'Idle_Stance'].includes(name);
  assert.deepEqual(batterClips(animationFor('play', 'middled'), all), { first: 'Forward_Defensive', then: 'Follow_Through', thenAt: 'end' });
  assert.deepEqual(batterClips(animationFor('play', 'middled'), today), { first: 'Forward_Defensive', then: null, thenAt: 'end' });
  assert.deepEqual(batterClips(animationFor('leave', 'safe', 'bouncer'), today), { first: 'Leave_Shoulder_Arms', then: null, thenAt: 'end' });
  assert.equal(CLIP_FALLBACKS.Leave_Duck_Sway, 'Leave_Shoulder_Arms');
  assert.deepEqual(batterClips(WATCHING, all), { first: null, then: null, thenAt: 'end' });
  assert.deepEqual(batterClips(animationFor('play', 'something_new'), today).first, 'Forward_Defensive');
});

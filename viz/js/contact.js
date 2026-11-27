// Where the bat meets the ball, and how the arms follow it. Pure functions on
// [x, y, z] arrays in any one frame of reference, tested under node; the
// batter (models/batter.js) and the keeper (models/keeper.js) apply them to bones.
import { rootStep } from './geometry.js';

export const STEER_BEFORE = 0.14; // seconds before impact over which the bat is steered onto the ball
export const STEER_AFTER = 0.2; // seconds after it over which the steer is let go
export const MISS = 0.08; // a play-and-miss: the bat's edge this far inside the ball's line

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const length = (a) => Math.sqrt(dot(a, a));
const unit = (a) => {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : a;
};
const smooth = (q) => {
  const c = Math.min(Math.max(q, 0), 1);
  return c * c * (3 - 2 * c);
};

// How much of the steer applies `since` seconds after impact (negative before): 0 until
// STEER_BEFORE before, rising to exactly 1 at impact, then let go over STEER_AFTER.
export function steerWeight(since, { before = STEER_BEFORE, after = STEER_AFTER } = {}) {
  if (!Number.isFinite(since)) return 0;
  if (since <= 0) return smooth(1 + since / before);
  return 1 - smooth(since / after);
}

// Where the bat's reference point must be at impact. kind:
//   'face'  middled: the middle of the face, with the ball resting on it
//   'edge'  edged: the outside edge, with the ball against it
//   'miss'  play-and-miss: the outside edge MISS inside the ball's line
//   'gate'  bowled through the gate: the inside edge MISS outside the ball's line
// ball: the ball's centre at impact. direction: the unit vector out of the face ('face'),
// out of the outside edge ('edge', 'miss') or out of the inside edge ('gate').
export function contactTarget(ball, kind, direction, { radius, miss = MISS }) {
  const offset = kind === 'face' || kind === 'edge' ? radius : miss;
  return sub(ball, scale(unit(direction), offset));
}

// Where on the blade the ball is met: the point of the line through `middle` along `axis` (the
// blade's length, a unit vector) nearest `target`, kept within `half` of the middle. The middle
// third of a blade is still its middle: a low ball is met a little lower on the face, a high one
// a little higher, as a batter meets them.
export const SLIDE = 0.09;
export function alongBlade(middle, axis, target, half = SLIDE) {
  const k = Math.min(Math.max(dot(sub(target, middle), axis), -half), half);
  return add(middle, scale(axis, k));
}

// The largest s in [0, 1] for which moving every grip by s * delta leaves each within its
// arm's reach of its shoulder. grips, shoulders: [point, point]; reaches: [metres, metres].
// When no s keeps both in reach, the s that brings the worse hand closest.
export function reachScale(grips, delta, shoulders, reaches) {
  const dd = dot(delta, delta);
  if (dd === 0) return 1;
  let low = 0;
  let high = 1;
  let closest = 1;
  grips.forEach((grip, i) => {
    const g = sub(grip, shoulders[i]);
    const b = dot(g, delta);
    const c = dot(g, g) - reaches[i] * reaches[i];
    const disc = b * b - dd * c;
    closest = Math.min(closest, Math.min(Math.max(-b / dd, 0), 1));
    if (disc < 0) {
      high = -1; // never in reach
      return;
    }
    const root = Math.sqrt(disc);
    low = Math.max(low, (-b - root) / dd);
    high = Math.min(high, (-b + root) / dd);
  });
  if (high >= low && high >= 0) return Math.min(Math.max(high, 0), 1);
  return closest;
}

// Moves the bat's reference point `ref` towards `target` by `weight` of the way, as far as
// both hands, carried with the bat, stay within reach. Returns the move, how far the
// reference point is left from the full target, and whether the arms limited it.
export function steer({ target, ref, grips, shoulders, reaches, weight = 1 }) {
  const wanted = scale(sub(target, ref), weight);
  const s = reachScale(grips, wanted, shoulders, reaches);
  const delta = scale(wanted, s);
  return { delta, s, limited: s < 1 - 1e-9, error: length(sub(add(ref, delta), target)) };
}

// The head's turn to follow the ball, on top of the clip: the yaw (about `up`) and pitch that take
// the direction `reference` (where the clip's head already looks) to `toBall`, each clamped so the
// head and cap never swing into the arms or the bat. Angles in radians; positive yaw is
// anticlockwise seen from above, positive pitch is up.
export const LOOK_LIMITS = { yaw: 0.7, up: 0.15, down: 0.4 };
export function lookTurn(reference, toBall, up = [0, 1, 0], limits = LOOK_LIMITS) {
  const flat = (v) => sub(v, scale(up, dot(v, up)));
  const a = unit(flat(reference));
  const b = unit(flat(toBall));
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const yaw = Math.atan2(dot(cross, up), dot(a, b));
  const elevation = (v) => Math.asin(Math.min(Math.max(dot(unit(v), up), -1), 1));
  const pitch = elevation(toBall) - elevation(reference);
  return {
    yaw: Math.min(Math.max(yaw, -limits.yaw), limits.yaw),
    pitch: Math.min(Math.max(pitch, -limits.down), limits.up),
  };
}

// The whole steer for one frame, in scene axes (x across the pitch to the off side, y up, z along
// it). pose: the clip's bat and arms as posed, { middle (the face's or an edge's middle point),
// out (the unit direction out of it), axis (down the blade), grips, shoulders, reaches }.
// The ball is met within the blade's middle third; across and along the pitch the batter's
// whole body moves as far as the body rule and a short step allow (geometry.js, rootStep);
// the rest moves the bat as far as both hands can follow. Returns the root's move [across,
// along], the bat's move, the slide down the blade, and how far the contact point is left
// from the ball's (`error`, at weight 1) and whether the arms limited it.
export const LIFT = { down: 0.15, up: 0.04 }; // knees bent up to 15 cm, up on the toes up to 4 cm
export const SWING = 0.6; // radians the bat may swing about the top hand, out to a wide ball, down or up
export const HEAD_CLEAR = 0.16; // the blade's line stays this far from the centre of the head

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// v turned by `angle` about the unit vector `axis` (Rodrigues).
export function rotate(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

// How far a hip can rise straight up (along `up`) with its ankle staying where it is, for a
// leg of total length `leg`: 0 when the leg is already straight.
export function legSlack(hip, ankle, leg, up = [0, 1, 0]) {
  const h = sub(hip, ankle);
  const b = dot(h, up);
  const disc = b * b - (dot(h, h) - leg * leg);
  return disc > 0 ? Math.max(-b + Math.sqrt(disc), 0) : 0;
}

// The distance from point p to the segment a-b.
export function segmentDistance(p, a, b) {
  const ab = sub(b, a);
  const t = Math.min(Math.max(dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12), 0), 1);
  return length(sub(p, add(a, scale(ab, t))));
}

// The whole steer for one frame, in scene axes (x across the pitch to the off side, y up, z along
// it). pose: the clip's bat and body as posed, { middle (the face's or an edge's middle point),
// out (the unit direction out of it), axis (down the blade), toe (the end of the blade), head
// (the centre of the head), grips, shoulders, reaches, top (which grip is the top hand's),
// rise (how far the body can go up with both feet planted; legSlack) }.
// In turn, each taking what the one before left:
//   the ball is met within the blade's middle third (alongBlade);
//   the whole body shifts across and along the pitch within the body rule and a short step
//   (geometry.js, rootStep), and down (knees bending) or up (on the toes) within LIFT;
//   the bat swings about the top hand towards the ball, up to SWING, as far as the bottom hand
//   can follow and the blade stays clear of the head: angled out to a wide ball, down to a low
//   one, up to a high one;
//   the bat moves, as far as both hands can follow it.
// Returns each move, how far the contact point is left from the ball's (`error`, at weight 1),
// and whether it was limited (`limited`: something could not reach this frame's goal).
export function planContact({ impact, kind, radius, weight = 1, rootX, bodyEdge, pose }) {
  const target = contactTarget(impact, kind, pose.out, { radius });
  const start = alongBlade(pose.middle, pose.axis, target);
  const slide = dot(sub(start, pose.middle), pose.axis);
  const goal = add(start, scale(sub(target, start), weight));
  const root = rootStep(rootX, [goal[0] - start[0], goal[2] - start[2]], { bodyEdge });
  // up only as far as both feet can stay planted (pose.rise, from the legs' slack)
  const lift = Math.min(Math.max(goal[1] - start[1], -LIFT.down), Math.min(LIFT.up, pose.rise ?? LIFT.up));
  const shift = (p) => [p[0] + root[0], p[1] + lift, p[2] + root[1]];
  const ref = shift(start);
  const grips = pose.grips.map(shift);
  const shoulders = pose.shoulders.map(shift);
  const head = shift(pose.head);
  const toe = shift(pose.toe);
  const top = pose.top ?? 0;
  const bottom = 1 - top;
  const pivot = grips[top];

  // the swing about the top hand that points the contact point at the goal, cut back until it fits
  const from = sub(ref, pivot);
  const to = sub(goal, pivot);
  const turn = cross(from, to);
  const axis = length(turn) > 1e-12 ? unit(turn) : [1, 0, 0];
  const full = Math.atan2(length(turn), dot(from, to));
  const widest = Math.min(full, SWING);
  const clearNow = segmentDistance(head, pivot, toe);
  const fits = (angle) => {
    const hand = add(pivot, rotate(sub(grips[bottom], pivot), axis, angle));
    const blade = add(pivot, rotate(sub(toe, pivot), axis, angle));
    return length(sub(hand, shoulders[bottom])) <= pose.reaches[bottom] + 1e-9
      && segmentDistance(head, pivot, blade) >= Math.min(HEAD_CLEAR, clearNow) - 1e-9;
  };
  let angle = 0;
  if (widest > 1e-9 && fits(widest)) angle = widest;
  else if (widest > 1e-9) {
    let low = 0;
    let high = widest;
    for (let i = 0; i < 30; i += 1) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid; else high = mid;
    }
    angle = low;
  }
  const swung = add(pivot, rotate(from, axis, angle));
  const swungGrips = grips.map((g, i) => (i === top ? g : add(pivot, rotate(sub(g, pivot), axis, angle))));
  const result = steer({ target: goal, ref: swung, grips: swungGrips, shoulders, reaches: pose.reaches });
  const reached = add(swung, result.delta);
  return {
    target, slide, root, lift, swing: { pivot, axis, angle }, delta: result.delta, s: result.s,
    limited: length(sub(reached, goal)) > 1e-6,
    error: length(sub(reached, target)),
  };
}

// Two-bone reach: the elbow and hand for a shoulder reaching for `target` with an upper arm
// and forearm of the given lengths, the elbow bent towards `pole`. A target out of reach
// gets the straight arm pointing at it; `reached` says whether the hand is on it.
export function twoBone(shoulder, target, upper, fore, pole) {
  const toTarget = sub(target, shoulder);
  const want = length(toTarget);
  const dist = Math.min(Math.max(want, Math.abs(upper - fore) + 1e-6), upper + fore);
  const dir = want > 0 ? scale(toTarget, 1 / want) : [0, -1, 0];
  const along = (upper * upper - fore * fore + dist * dist) / (2 * dist);
  const out = Math.sqrt(Math.max(upper * upper - along * along, 0));
  let bend = sub(sub(pole, shoulder), scale(dir, dot(sub(pole, shoulder), dir)));
  if (length(bend) < 1e-9) bend = Math.abs(dir[1]) < 0.9 ? [-dir[2], 0, dir[0]] : [1, 0, 0]; // any perpendicular
  bend = unit(bend);
  return {
    elbow: add(add(shoulder, scale(dir, along)), scale(bend, out)),
    hand: add(shoulder, scale(dir, dist)),
    reached: want <= upper + fore + 1e-9,
  };
}

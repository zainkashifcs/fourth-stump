// One delivery as a piece of animation: the Hawk-Eye style tube, its drop
// curtain and bounce ring, and a pure function of time that poses the shared
// actors (ball, bowler, batter, wicket). `apply(t)` can be called for any t in
// any order, which is what lets three panels share one batter and one ball,
// and lets reduced motion jump straight to the last frame.
//
// The clock starts `lead` seconds before the ball leaves the hand: the length
// of the run-up when one is shown, otherwise zero.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { pointToScene } from './coords.js';
import { extendToKeeper } from './geometry.js';
import { WATCHING } from './outcomes.js';
import { TAKE, cuesFor } from './audio.js';

const SAMPLES = 120;
const RADIAL = 6;
const TUBE_RADIUS = 0.04;
const FLIGHT_SPEED = 13; // metres of path per second: slow motion, so the eye can follow
const CATCH = 0.42; // seconds an edge takes to carry to slip
const LIFT_IN = 0.15; // seconds over which the oversized ball rises off the line, so it leaves the hand exactly
const TAIL = { dead: 1.3, 'edge-short': 1.4, 'edge-carry': 1.5, stumps: 1.2, through: 0.55 }; // a dismissal leaves time for the appeal

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);
const easeOut = (q) => 1 - (1 - q) * (1 - q);
const smooth = (q) => q * q * (3 - 2 * q);
const hop = (q, height) => Math.sin(Math.PI * clamp01(q)) * height;

class Polyline extends THREE.Curve {
  constructor(points) {
    super();
    this.points = points;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const f = clamp01(t) * (this.points.length - 1);
    const index = Math.min(Math.floor(f), this.points.length - 2);
    return target.lerpVectors(this.points[index], this.points[index + 1], f - index);
  }
}

// Resamples a path to evenly spaced points on a spline through each flight
// leg, keeping the corner at the bounce sharp.
function smoothPath(path, bounceIndex) {
  const points = path.map(pointToScene);
  const bounced = bounceIndex > 0 && bounceIndex < points.length - 1;
  const legs = bounced ? [points.slice(0, bounceIndex + 1), points.slice(bounceIndex)] : [points];
  const curve = new THREE.CurvePath();
  legs.forEach((leg) => curve.add(new THREE.CatmullRomCurve3(leg, false, 'centripetal')));
  const length = curve.getLength();
  return {
    line: new Polyline(curve.getSpacedPoints(SAMPLES)),
    length,
    bounceFraction: bounced ? curve.getCurveLengths()[0] / length : null,
  };
}

// How far along the path (0..1) an original path index is.
function fractionAtIndex(path, index) {
  const points = path.map(pointToScene);
  let upTo = 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += points[i].distanceTo(points[i - 1]);
    if (i <= index) upTo = total;
  }
  return total > 0 ? upTo / total : 0;
}

// How far along the resampled line (0..1) it first reaches the plane data y = planeY.
function fractionAtPlane(points, planeY) {
  const i = points.findIndex((p) => -p.z <= planeY);
  if (i <= 0) return i === 0 ? 0 : 1;
  const before = -points[i - 1].z;
  const after = -points[i].z;
  return (i - 1 + (before - planeY) / (before - after)) / (points.length - 1);
}

// Materials are shared between plays of the same colour and never disposed.
const shared = new Map();
function material(key, make) {
  if (!shared.has(key)) shared.set(key, make());
  return shared.get(key);
}
const ringGeometry = { core: new THREE.RingGeometry(0.1, 0.16, 20), glow: new THREE.RingGeometry(0.16, 0.3, 20) };

function thinLine(points, color, kind) {
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const options = kind === 'mean'
    ? { color, linewidth: 2, dashed: true, dashSize: 0.35, gapSize: 0.25 }
    : { color, linewidth: 1.2, transparent: true, opacity: 0.4, depthWrite: false };
  const line = new Line2(geometry, material(`line:${kind}:${color}`, () => new LineMaterial(options)));
  if (kind === 'mean') line.computeLineDistances();
  return line;
}

function buildCurtain(line, color) {
  const positions = [];
  const indices = [];
  line.points.forEach((p, i) => {
    positions.push(p.x, p.y, p.z, p.x, 0.014, p.z);
    if (i < SAMPLES) indices.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return new THREE.Mesh(geometry, material(`curtain:${color}`, () => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false,
  })));
}

function buildRing(position, color) {
  const ring = new THREE.Group();
  ring.add(
    new THREE.Mesh(ringGeometry.core, material('ring:core', () => new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }))),
    new THREE.Mesh(ringGeometry.glow, material(`ring:glow:${color}`, () => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }))),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(position.x, 0.02, position.z);
  return ring;
}

// spec: { path, bounceIndex, arm, pauseIndex?, lead?, color, fan?, mean? }
// batY: where along the pitch (data y) the ball meets the bat; the bat plane when not given.
export function createPlay(spec, constants, catchPoint, { batY } = {}) {
  const { bounceIndex, color, arm } = spec;
  // the line runs on past the stumps to the keeper's plane; only a delivery left or missed is drawn that far
  const path = extendToKeeper(spec.path, { floor: constants.ball_radius });
  const lead = spec.lead ?? 0;
  const { line, length, bounceFraction } = smoothPath(path, bounceIndex);
  const stumpsFraction = fractionAtPlane(line.points, 0);
  const flight = length / FLIGHT_SPEED;
  const ground = constants.ball_radius;

  // where the ball reaches the bat: the plane of the bat's face at contact (models/batter.js), exactly
  const batFraction = fractionAtPlane(line.points, batY ?? constants.bat_plane_y);
  const batTime = batFraction * flight;
  const atBat = line.getPoint(batFraction); // the ball as it reaches the bat, where a played ball is met
  const lineAtBat = atBat.x;
  const atKeeper = line.getPoint(1); // the end of the drawn line: the keeper's plane
  const pauseTime = spec.pauseIndex == null ? null
    : (spec.pauseIndex === bounceIndex && bounceFraction != null ? bounceFraction : fractionAtIndex(path, spec.pauseIndex)) * flight;

  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(line, SAMPLES, TUBE_RADIUS, RADIAL, false),
    material(`tube:${color}`, () => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45, flatShading: true })),
  );
  const curtain = buildCurtain(line, color);
  const ring = bounceFraction == null ? null : buildRing(line.getPoint(bounceFraction), color);
  const extras = [
    ...(spec.fan ?? []).map((sample) => thinLine(sample.map(pointToScene), color, 'fan')),
    ...(spec.mean ? [thinLine(spec.mean.map(pointToScene), color, 'mean')] : []),
  ];
  const group = new THREE.Group();
  group.add(tube, curtain, ...extras);
  if (ring) group.add(ring);

  let animation = WATCHING;
  let eventFraction = stumpsFraction; // where the ball meets the bat or reaches the stumps
  let endFraction = 1; // where the ball leaves the line
  const impact = new THREE.Vector3();
  const from = new THREE.Vector3();

  function setOutcome(next) {
    animation = next;
    eventFraction = next.ball === 'dead' || next.ball.startsWith('edge') ? batFraction : stumpsFraction;
    endFraction = next.ball === 'through' ? 1 : eventFraction;
    line.getPoint(eventFraction, impact);
    line.getPoint(endFraction, from);
  }

  let held = false; // the ball is in the keeper's gloves this frame

  // Where the ball is `tau` seconds after it leaves the line: off the bat, at the stumps, or at the keeper.
  // Scene axes: +X off side, +Y up, +Z behind the batter's wicket.
  function afterEvent(tau, ball, keeper) {
    const p = ball.group.position.copy(from);
    let scale = 1;
    if (animation.ball === 'dead') {
      const q = clamp01(tau / 0.45);
      const roll = easeOut(clamp01((tau - 0.45) / 0.7));
      p.x += 0.5 * easeOut(q) + 0.12 * roll;
      p.z -= 0.85 * easeOut(q) + 0.3 * roll;
      p.y = ground + (from.y - ground) * (1 - q) * (1 - q) + hop((tau - 0.45) / 0.25, 0.07);
    } else if (animation.ball === 'edge-short') {
      const q = clamp01(tau / 0.42);
      const skid = easeOut(clamp01((tau - 0.42) / 0.8));
      // a thick edge that drops beside the wicket and trickles on: in shot, and well short of slip
      p.x = THREE.MathUtils.lerp(from.x, Math.max(from.x, 0.25) + 0.55, q) + 0.2 * skid;
      p.z = THREE.MathUtils.lerp(from.z, -0.9, q) + 0.5 * skid;
      p.y = THREE.MathUtils.lerp(from.y, ground, q * q) + hop((tau - 0.42) / 0.3, 0.12);
    } else if (animation.ball === 'edge-carry') {
      const q = clamp01(tau / CATCH);
      p.lerp(catchPoint, q);
      p.y += hop(q, 0.1);
    } else if (animation.ball === 'stumps') {
      const q = clamp01(tau / 0.6);
      p.x += 0.4 * easeOut(q); // glances off the stump and stops beside the wicket, in shot
      p.z += 0.3 * easeOut(q);
      p.y = THREE.MathUtils.lerp(from.y, ground, q * q);
    } else if (keeper?.holding) {
      keeper.gloves(p); // taken: it stays in his gloves
      held = true;
    } else {
      scale = 1 - smooth(clamp01(tau / 0.15)); // no keeper to take it: it fades at his plane
    }
    ball.group.scale.setScalar(Math.max(scale, 0.001));
    ball.group.visible = scale > 0.01;
  }

  // What the keeper does: gather a ball that goes through, celebrate a dismissal, else crouch.
  // When the ball leaves the line (seconds from the release). A ball that goes through takes
  // exactly TAKE from the stumps to the keeper's gloves, the instant his gloves close on it in
  // the sound (audio.js); everywhere else it flies at FLIGHT_SPEED.
  const stumpsTime = stumpsFraction * flight;
  const endOfLine = () => (animation.ball === 'through' ? stumpsTime + TAKE : endFraction * flight);
  // How far along the line (0..1) the ball is t seconds after the release.
  function along(t) {
    if (animation.ball === 'through' && t > stumpsTime) return Math.min(stumpsFraction + (1 - stumpsFraction) * ((t - stumpsTime) / TAKE), 1);
    return THREE.MathUtils.clamp(t / flight, 0, endFraction);
  }

  function keeperFor(t, eventTime, endTime) {
    if (animation === WATCHING) return { mode: 'idle' };
    if (animation.ball === 'through') return { mode: 'gather', since: t - endTime, ball: atKeeper };
    if (animation.ball === 'stumps') return { mode: 'celebrate', since: t - eventTime };
    if (animation.ball === 'edge-carry') return { mode: 'celebrate', since: t - eventTime - CATCH };
    return { mode: 'idle' };
  }

  // actors: { ball, bowler, batter, wicket, keeper?, burst? }. clock: seconds that always run, for the
  // idle loops. animate: false under reduced motion (no head turn, keeper crouching, no burst).
  function apply(time, actors, clock = time, { animate = true } = {}) {
    held = false;
    const t = time - lead; // seconds since the ball left the hand
    const eventTime = eventFraction * flight;
    const endTime = endOfLine();
    const f = along(t);
    const drawn = Math.floor(f * SAMPLES);
    tube.geometry.setDrawRange(0, drawn * RADIAL * 6);
    curtain.geometry.setDrawRange(0, drawn * 6);
    extras.forEach((extra) => { extra.visible = t >= 0; }); // nothing is tracked until the ball is bowled
    if (ring) {
      const since = t - bounceFraction * flight;
      ring.visible = since >= 0;
      ring.scale.setScalar(1 + 0.9 * Math.max(0, 1 - since / 0.35));
    }

    const caught = animation.ball === 'edge-carry';
    actors.bowler.pose({
      point: path[0],
      arm,
      sinceRelease: t,
      runUp: lead > 0,
      appealAt: animation.flash ? eventTime + (caught ? CATCH : 0) : null,
    });

    // the keeper first, so a ball he has taken can sit in his gloves
    actors.keeper?.pose({ clock, animate, ...keeperFor(t, eventTime, endTime) });

    const { ball } = actors;
    ball.group.visible = true;
    ball.group.scale.setScalar(1);
    if (t < 0) {
      actors.bowler.handPosition(ball.group.position); // still in the hand
    } else {
      if (t <= endTime) line.getPoint(f, ball.group.position);
      else afterEvent(t - endTime, ball, animate ? actors.keeper : null);
      if (!held) ball.group.position.y += ball.lift * clamp01(t / LIFT_IN);
    }
    ball.spin.rotation.x = -Math.max(t, 0) * 16;

    // the batter never moves before the pause, so the game gives nothing away
    actors.batter.pose(clock, animation === WATCHING ? null : {
      animation,
      sinceArrival: t - batTime,
      earliest: pauseTime == null ? -Infinity : pauseTime - batTime,
      lineX: lineAtBat + animation.bat,
      impact: atBat,
      ball: ball.group.position,
      sinceEvent: t - eventTime,
      animate,
    });
    actors.wicket.pose(animation.ball === 'stumps' ? t - eventTime : null);
    const puff = animation.ball === 'dead' ? 'dust' : animation.ball.startsWith('edge') ? 'flash' : null;
    actors.burst?.pose(animate ? puff : null, t - eventTime, atBat);
  }

  // The sounds this delivery makes and when, on the same clock as apply().
  function cues() {
    const eventTime = lead + eventFraction * flight;
    return [
      ...(bounceFraction == null ? [] : [{ sound: 'bounce', time: lead + bounceFraction * flight }]),
      ...cuesFor(animation.name).map(({ sound, at }) => ({ sound, time: eventTime + at })),
    ];
  }

  function dispose() {
    group.removeFromParent();
    tube.geometry.dispose();
    curtain.geometry.dispose();
    extras.forEach((extra) => extra.geometry.dispose());
  }

  setOutcome(WATCHING);
  return {
    group,
    apply,
    setOutcome,
    cues,
    dispose,
    lead,
    pauseTime: pauseTime == null ? null : lead + pauseTime,
    impact, // where the ball meets the bat or the stumps, in scene coordinates
    get held() { return held; }, // the ball sits in the keeper's gloves in the frame last posed
    contactTime: lead + batTime, // when the ball reaches the bat, on the same clock as apply()
    get animation() { return animation; },
    get decided() { return animation !== WATCHING; },
    get eventTime() { return lead + eventFraction * flight; },
    get duration() { return lead + endOfLine() + TAIL[animation.ball]; },
    get keeperTime() { return animation.ball === 'through' ? lead + endOfLine() : null; }, // the ball in his gloves
  };
}

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
import { WATCHING } from './outcomes.js';
import { cuesFor } from './audio.js';

const SAMPLES = 120;
const RADIAL = 6;
const TUBE_RADIUS = 0.04;
const FLIGHT_SPEED = 13; // metres of path per second: slow motion, so the eye can follow
const CATCH = 0.42; // seconds an edge takes to carry to slip
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
export function createPlay(spec, constants, catchPoint) {
  const { path, bounceIndex, color, arm } = spec;
  const lead = spec.lead ?? 0;
  const { line, length, bounceFraction } = smoothPath(path, bounceIndex);
  const flight = length / FLIGHT_SPEED;
  const ground = constants.ball_radius;

  // where the ball reaches the bat: the first sample past the popping crease, after any bounce
  const afterBounce = Math.ceil((bounceFraction ?? 0.5) * SAMPLES);
  const found = line.points.findIndex((p, i) => i >= afterBounce && p.z >= -constants.bat_plane_y);
  const batFraction = (found < 0 ? SAMPLES : found) / SAMPLES;
  const batTime = batFraction * flight;
  const lineAtBat = line.getPoint(batFraction).x;
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
  let eventFraction = 1;
  const from = new THREE.Vector3();
  const direction = new THREE.Vector3();

  function setOutcome(next) {
    animation = next;
    eventFraction = next.ball === 'dead' || next.ball.startsWith('edge') ? batFraction : 1;
    line.getPoint(eventFraction, from);
    direction.copy(from).sub(line.getPoint(eventFraction - 2 / SAMPLES)).normalize();
  }

  // Where the ball is `tau` seconds after it met the bat or reached the stumps.
  // Scene axes: +X off side, +Y up, +Z behind the batter's wicket.
  function afterEvent(tau, ball) {
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
    } else {
      const q = clamp01(tau / 0.42);
      p.addScaledVector(direction, 3.2 * q);
      p.y = Math.max(p.y, ground);
      scale = 1 - smooth(clamp01((q - 0.7) / 0.3)); // gone through to the keeper, out of shot
    }
    ball.group.scale.setScalar(Math.max(scale, 0.001));
    ball.group.visible = scale > 0.01;
  }

  // actors: { ball, bowler, batter, wicket }. clock: seconds that always run, for the idle loop.
  function apply(time, actors, clock = time) {
    const t = time - lead; // seconds since the ball left the hand
    const eventTime = eventFraction * flight;
    const f = THREE.MathUtils.clamp(t / flight, 0, eventFraction);
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

    const { ball } = actors;
    ball.group.visible = true;
    ball.group.scale.setScalar(1);
    if (t < 0) {
      actors.bowler.handPosition(ball.group.position); // still in the hand
    } else {
      if (t <= eventTime) line.getPoint(f, ball.group.position);
      else afterEvent(t - eventTime, ball);
      ball.group.position.y += ball.lift;
    }
    ball.spin.rotation.x = -Math.max(t, 0) * 16;

    // the batter never moves before the pause, so the game gives nothing away
    const shot = animation.batter === 'stance' ? null : animation.ball.startsWith('edge') ? 'edge' : animation.batter;
    const earliest = pauseTime == null ? -Infinity : pauseTime - batTime;
    actors.batter.pose(clock, shot, t - batTime, earliest, lineAtBat + animation.bat);
    actors.wicket.pose(animation.ball === 'stumps' ? t - eventTime : null);
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
    impact: from, // where the ball meets the bat or the stumps, in scene coordinates
    get decided() { return animation !== WATCHING; },
    get eventTime() { return lead + eventFraction * flight; },
    get duration() { return lead + eventFraction * flight + TAIL[animation.ball]; },
  };
}

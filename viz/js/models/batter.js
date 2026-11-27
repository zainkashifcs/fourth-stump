// The classic Test batter (assets/batter.glb): a right-hander at the popping
// crease, side-on, standing on the leg side with his chest to the off side.
// Idle_Stance loops until the batter commits; the outcome's shot clip (outcomes.js)
// is timed so its contact frame lands as the ball arrives, then holds or hands on
// to the clip that follows it. In the last 0.14 s before a played ball arrives the
// bat is steered so its face or edge meets the ball exactly, and both arms are
// re-solved onto the handle (contact.js). On a leave the head follows the ball.
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { STANCE_X, batterRootX } from '../geometry.js';
import { batterClips } from '../outcomes.js';
import { legSlack, lookTurn, planContact, steerWeight, twoBone } from '../contact.js';
import { createRig } from './rig.js';
import { placeholderBat, placeholderFigure } from './placeholder.js';

const IDLE = 'Idle_Stance';
const LOOK_IN = 0.15; // seconds over which the head's turn comes in once the ball has passed the bat
const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);
const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
const arr = (v) => [v.x, v.y, v.z];
const vec = (a, target = new THREE.Vector3()) => target.set(a[0], a[1], a[2]);

// The bat's geometry and both arms, read from the rest pose: the model's build keeps both
// hands on the handle there, so the grips fix each forearm's length and direction.
// userData from the file wins where it is given (metres, rig scale).
function calibrate(rig, info) {
  const bat = rig.node('bat');
  const mesh = (() => { let found = null; rig.root.traverse((o) => { if (!found && o.isSkinnedMesh) found = o; }); return found; })();
  const arms = { L: [rig.node('armL'), rig.node('foreL')], R: [rig.node('armR'), rig.node('foreR')] };
  if (!bat || !mesh || !arms.L.every(Boolean) || !arms.R.every(Boolean)) return null;
  rig.root.updateMatrixWorld(true);

  // the bat's own vertices, in its bone's frame
  const bones = mesh.skeleton.bones;
  const batIndex = bones.indexOf(bat);
  const { skinIndex, skinWeight } = mesh.geometry.attributes;
  const toBat = new THREE.Matrix4().copy(bat.matrixWorld).invert();
  const points = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < skinIndex.count; i += 1) {
    let best = 0;
    let weight = -1;
    for (let k = 0; k < 4; k += 1) {
      if (skinWeight.getComponent(i, k) > weight) { weight = skinWeight.getComponent(i, k); best = skinIndex.getComponent(i, k); }
    }
    if (best !== batIndex) continue;
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(toBat);
    points.push([v.x, v.y, v.z]);
  }
  if (points.length < 8) return null;

  // the long axis runs down the handle from the bone's origin; read which way, not assumed
  const reach = [0, 1, 2].map((k) => Math.max(...points.map((p) => Math.abs(p[k]))));
  const k = reach.indexOf(Math.max(...reach));
  const far = points.reduce((a, p) => (Math.abs(p[k]) > Math.abs(a[k]) ? p : a));
  const sign = Math.sign(far[k]) || 1;
  const along = (p) => p[k] * sign;
  const handle = num(info.bat_handle, 0.3);
  const blade = num(info.bat_blade, Math.max(...points.map(along)) - handle);
  const bladePoints = points.filter((p) => along(p) > handle + 0.03);
  const others = [0, 1, 2].filter((i) => i !== k);
  const span = (i) => [Math.min(...bladePoints.map((p) => p[i])), Math.max(...bladePoints.map((p) => p[i]))];
  const [thick, wide] = span(others[0])[1] - span(others[0])[0] < span(others[1])[1] - span(others[1])[0] ? others : [others[1], others[0]];
  const mid = (i) => (span(i)[0] + span(i)[1]) / 2;
  const at = (alongValue, values) => {
    const p = [0, 0, 0];
    p[k] = sign * alongValue;
    Object.entries(values).forEach(([i, value]) => { p[Number(i)] = value; });
    return new THREE.Vector3(...p);
  };
  const middle = handle + blade / 2;
  const face = span(thick).map((t) => at(middle, { [thick]: t, [wide]: mid(wide) })); // the two sides of the blade
  const axis = at(1, {}); // down the blade, in the bone's frame
  const edges = span(wide).map((w) => at(middle, { [wide]: w, [thick]: mid(thick) }));
  const handlePoints = points.filter((p) => along(p) < handle);
  const centre = (i) => handlePoints.reduce((s, p) => s + p[i], 0) / Math.max(handlePoints.length, 1);
  const grip = (g) => at(g, { [thick]: centre(thick), [wide]: centre(wide) });
  const top = /^r/i.test(String(info.top_hand ?? '')) ? 'R' : 'L'; // 'left' | 'right' | 'L' | 'R'; a right-hander's top hand is his left
  const grips = { [top]: grip(num(info.grip_top, 0.06)), [top === 'L' ? 'R' : 'L']: grip(num(info.grip_bottom, 0.19)) };

  const sides = Object.fromEntries(Object.entries(arms).map(([side, [arm, fore]]) => {
    const gripWorld = bat.localToWorld(grips[side].clone());
    const hand = fore.worldToLocal(gripWorld.clone());
    const forearm = num(info.forearm, hand.length());
    return [side, {
      arm, fore,
      upper: num(info.upper_arm, fore.position.length()),
      forearm,
      hand: hand.normalize().multiplyScalar(forearm), // the grip point in the forearm's frame
      grip: grips[side],
    }];
  }));
  const head = rig.node('head');
  const toe = at(handle + blade, { [thick]: mid(thick), [wide]: mid(wide) });
  // the centre of the head, in its bone's frame: the mean of the head's own vertices
  const headCentre = new THREE.Vector3();
  if (head) {
    const headIndex = bones.indexOf(head);
    const toHead = new THREE.Matrix4().copy(head.matrixWorld).invert();
    let n = 0;
    for (let i = 0; i < skinIndex.count; i += 1) {
      let best = 0;
      let weight = -1;
      for (let j = 0; j < 4; j += 1) {
        if (skinWeight.getComponent(i, j) > weight) { weight = skinWeight.getComponent(i, j); best = skinIndex.getComponent(i, j); }
      }
      if (best !== headIndex) continue;
      headCentre.add(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(toHead));
      n += 1;
    }
    headCentre.divideScalar(Math.max(n, 1));
  }
  // the body bone carries everything above the feet; the legs are re-solved so the feet stay planted
  const body = rig.node('body');
  const legs = ['L', 'R'].map((side) => ({ leg: rig.node(`leg${side}`), shin: rig.node(`shin${side}`), foot: rig.node(`foot${side}`) }))
    .filter((l) => l.leg && l.shin && l.foot);
  // the bones a frame may change on top of the clip
  const touched = [
    { bone: bat, key: 'position' }, { bone: bat, key: 'quaternion' },
    ...Object.values(arms).flat().map((bone) => ({ bone, key: 'quaternion' })),
    ...(head ? [{ bone: head, key: 'quaternion' }] : []),
    ...(body ? [{ bone: body, key: 'position' }] : []),
    ...legs.flatMap((l) => [l.leg, l.shin, l.foot]).map((bone) => ({ bone, key: 'quaternion' })),
  ].map((entry) => ({ ...entry, saved: entry.bone[entry.key].clone() }));
  return {
    bat, face, edges, axis, toe, sides, head, headCentre, body, legs: body && legs.length === 2 ? legs : [], touched,
    top: Object.keys(sides).indexOf(top),
  };
}

// The mixer writes a bone only when the clip's value has changed since the last frame, so a
// change made on top of the clip would stay. Each frame first puts back what the clip had set.
function snapshot(geometry) {
  geometry.touched.forEach((entry) => entry.saved.copy(entry.bone[entry.key]));
  geometry.dirty = true;
}
function restore(geometry) {
  if (!geometry.dirty) return;
  geometry.touched.forEach((entry) => entry.bone[entry.key].copy(entry.saved));
  geometry.dirty = false;
}

export function buildBatter(gltf, constants) {
  const group = new THREE.Group();
  const home = toScene(STANCE_X, constants.bat_plane_y, 0);
  group.position.copy(home);
  group.rotation.y = Math.PI / 2; // chest to the off side, left shoulder to the bowler: rig +Z is data +x

  const rig = gltf && createRig(gltf, [IDLE], { snap: true });
  if (!rig?.has(IDLE)) {
    group.add(placeholderFigure(), placeholderBat(constants.bat_half_width));
    return { group, pose() {}, clips: [], lastSteer: null };
  }
  group.add(rig.root);

  // from the file: contact_time, seconds into Forward_Defensive and Edge_Flash at which the bat meets
  // the ball; bat_line, rig Z of the middle of the bat face at contact; body_edge, the largest rig Z
  // that head, torso, legs and pads reach
  const info = gltf.scene.getObjectByName('batter')?.userData ?? {};
  const contactTime = Number(info.contact_time) || 0.3;
  const reach = { batLine: Number(info.bat_line) || 0.7, bodyEdge: Number(info.body_edge) || 0.25, ballRadius: constants.ball_radius };
  const geometry = calibrate(rig, info);
  const has = (name) => rig.has(name);
  const isLeave = (clip) => clip.startsWith('Leave');
  const lead = (clip) => (isLeave(clip) ? rig.duration(clip) * 0.75 : contactTime);
  const state = { lastSteer: null };

  // scratch objects, so a frame allocates nothing of its own here
  const s = {
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(),
    q: new THREE.Quaternion(), p: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), axis: new THREE.Vector3(),
  };

  // Turns `bone` in the world so that its local direction `local` points along `want` (world).
  function aim(bone, local, want) {
    bone.getWorldQuaternion(s.p);
    s.a.copy(local).applyQuaternion(s.p).normalize();
    s.q.setFromUnitVectors(s.a, s.b.copy(want).normalize());
    s.p.premultiply(s.q);
    bone.parent.getWorldQuaternion(s.q).invert();
    bone.quaternion.copy(s.q.multiply(s.p));
    bone.updateMatrixWorld(true);
  }

  // Both arms onto their grips on the handle, each elbow bent the way the clip bends it.
  function solveArms() {
    Object.values(geometry.sides).forEach((side) => {
      const grip = geometry.bat.localToWorld(s.c.copy(side.grip));
      const shoulder = side.arm.getWorldPosition(s.d);
      const elbow = side.fore.getWorldPosition(new THREE.Vector3());
      const solved = twoBone(arr(shoulder), arr(grip), side.upper, side.forearm, arr(elbow));
      aim(side.arm, side.fore.position, vec(solved.elbow).sub(shoulder));
      const from = side.fore.getWorldPosition(s.d);
      aim(side.fore, side.hand, s.b.copy(grip).sub(from));
      side.gap = side.fore.localToWorld(s.a.copy(side.hand)).distanceTo(grip);
    });
  }

  // The bat's reference point for a kind of contact (the middle of the face, or of an edge), slid
  // `slide` metres down the blade, with the direction out of it and the blade's direction, in the world.
  function reference(kind, slide = 0) {
    const axis = arr(s.d.copy(geometry.axis).transformDirection(geometry.bat.matrixWorld));
    const along = (p) => p.map((value, i) => value + axis[i] * slide);
    const [f0, f1] = geometry.face.map((p, i) => geometry.bat.localToWorld((i ? s.b : s.a).copy(p)));
    if (kind === 'face') {
      const toBowler = f1.z < f0.z; // scene -Z is up the pitch, where the ball comes from
      const [front, back] = toBowler ? [f1, f0] : [f0, f1];
      return { ref: along(arr(front)), out: arr(front.clone().sub(back)), axis };
    }
    const [e0, e1] = geometry.edges.map((p, i) => geometry.bat.localToWorld((i ? s.b : s.a).copy(p)));
    const outside = e1.x > e0.x ? [e1, e0] : [e0, e1]; // scene +X is the off side: the outside edge of a right-hander
    const [edge, other] = kind === 'gate' ? [outside[1], outside[0]] : outside;
    return { ref: along(arr(edge)), out: arr(edge.clone().sub(other)), axis };
  }

  // The steer, in two parts. Across and along the pitch the whole batter moves (his root), within
  // the body rule (geometry.js) and a short step; that keeps his hands where the clip put them,
  // since at contact his arms are near full stretch. What is left, mostly height, moves the bat,
  // as far as both hands can follow it.
  // The clip's bat and arms as posed, in the world, for planContact (contact.js).
  function posed(kind) {
    group.updateMatrixWorld(true);
    const { ref: middle, out, axis } = reference(kind);
    const sides = Object.values(geometry.sides);
    return {
      middle, out, axis,
      toe: arr(geometry.bat.localToWorld(s.c.copy(geometry.toe))),
      head: geometry.head ? arr(geometry.head.localToWorld(s.c.copy(geometry.headCentre))) : [middle[0], middle[1] + 1.2, middle[2]],
      top: geometry.top,
      rise: geometry.legs.length ? Math.min(...geometry.legs.map((l) => legSlack(
        arr(l.leg.getWorldPosition(s.c)), arr(l.foot.getWorldPosition(s.d)), l.shin.position.length() + l.foot.position.length() - 0.002,
      ))) : 0,
      grips: sides.map((side) => arr(geometry.bat.localToWorld(s.c.copy(side.grip)))),
      shoulders: sides.map((side) => arr(side.arm.getWorldPosition(s.d))),
      reaches: sides.map((side) => side.upper + side.forearm - 0.001),
    };
  }

  // The body down (knees bending) or up (on the toes) by `lift` metres, the feet left where they
  // were: each leg re-solved from its hip to its ankle, each foot turned back to how it lay.
  function bend(lift) {
    const planted = geometry.legs.map((l) => ({
      ankle: l.foot.getWorldPosition(new THREE.Vector3()), turn: l.foot.getWorldQuaternion(new THREE.Quaternion()),
    }));
    const body = geometry.body;
    const before = body.parent.worldToLocal(body.getWorldPosition(s.a));
    const after = body.parent.worldToLocal(body.getWorldPosition(s.b).add(s.c.set(0, lift, 0)));
    body.position.add(after.sub(before));
    body.updateMatrixWorld(true);
    geometry.legs.forEach((l, i) => {
      const hip = l.leg.getWorldPosition(new THREE.Vector3());
      const knee = l.shin.getWorldPosition(new THREE.Vector3());
      const solved = twoBone(arr(hip), arr(planted[i].ankle), l.shin.position.length(), l.foot.position.length(), arr(knee));
      aim(l.leg, l.shin.position, vec(solved.elbow).sub(hip));
      aim(l.shin, l.foot.position, planted[i].ankle.clone().sub(l.shin.getWorldPosition(s.d)));
      l.foot.parent.getWorldQuaternion(s.q).invert();
      l.foot.quaternion.copy(s.q.multiply(planted[i].turn));
      l.foot.updateMatrixWorld(true);
      l.slip = l.foot.getWorldPosition(s.d).distanceTo(planted[i].ankle);
    });
  }

  function steerBat(weight, kind, impact) {
    const sides = Object.values(geometry.sides);
    const plan = planContact({
      impact: arr(impact), kind, radius: constants.ball_radius, weight, rootX: group.position.x, bodyEdge: reach.bodyEdge, pose: posed(kind),
    });
    const { target, slide, root: move, lift, swing } = plan;
    group.position.x += move[0];
    group.position.z += move[1];
    group.updateMatrixWorld(true);
    if (lift !== 0) bend(lift);
    const bat = geometry.bat;
    if (swing.angle > 0) {
      // about the top hand: the bat's origin goes round the pivot and the bat turns with it
      s.q.setFromAxisAngle(vec(swing.axis, s.axis), swing.angle);
      const pivot = vec(swing.pivot, s.c);
      const origin = bat.getWorldPosition(s.a).sub(pivot).applyQuaternion(s.q).add(pivot);
      bat.getWorldQuaternion(s.p).premultiply(s.q);
      bat.position.copy(bat.parent.worldToLocal(origin));
      bat.parent.getWorldQuaternion(s.q).invert();
      bat.quaternion.copy(s.q.multiply(s.p));
      bat.updateMatrixWorld(true);
    }
    const before = bat.parent.worldToLocal(bat.getWorldPosition(s.a));
    const after = bat.parent.worldToLocal(bat.getWorldPosition(s.b).add(vec(plan.delta, s.c)));
    bat.position.add(after.sub(before));
    bat.updateMatrixWorld(true);
    solveArms();
    const result = plan;
    // read back from the bones, not from the sums: how far the reference point now is from the
    // full target (the contact error, at impact), and each hand from its grip
    const now = reference(kind, slide).ref;
    const error = Math.hypot(...now.map((value, i) => value - target[i]));
    state.lastSteer = {
      kind, weight, error, limited: result.limited, hands: sides.map((side) => side.gap), root: move, lift, swing: swing.angle,
      feet: geometry.legs.map((l) => l.slip ?? 0), // how far each foot moved off its planted spot
      residual: target.map((value, i) => value - now[i]), // what the arms could not take, scene axes
      clearance: Math.hypot(...now.map((value, i) => value - impact.getComponent(i))), // reference point to the ball's centre
    };
  }

  // The head follows the ball on a leave, on top of the clip and clamped clear of arms and bat.
  function follow(weight, ball, impact) {
    const head = geometry.head;
    if (!head || weight <= 0) return;
    group.updateMatrixWorld(true);
    const at = head.getWorldPosition(s.a);
    const turn = lookTurn(arr(s.b.copy(impact).sub(at)), arr(s.c.copy(ball).sub(at)));
    head.getWorldQuaternion(s.p);
    s.q.setFromAxisAngle(s.up, turn.yaw * weight);
    s.p.premultiply(s.q);
    s.d.copy(ball).sub(at).setY(0).normalize(); // pitch about the horizontal axis across the line of sight
    s.axis.crossVectors(s.d, s.up).normalize();
    if (s.axis.lengthSq() > 0) s.p.premultiply(s.q.setFromAxisAngle(s.axis, turn.pitch * weight));
    head.parent.getWorldQuaternion(s.q).invert();
    head.quaternion.copy(s.q.multiply(s.p));
    head.updateMatrixWorld(true);
  }

  // clock: seconds for the idle loop. shot: null for the stance, or
  //   animation     from outcomes.js
  //   sinceArrival  seconds since the ball reached the bat (negative before)
  //   earliest      the first moment, on the same scale, at which the batter may move
  //   lineX         the line, in data x, the bat goes to
  //   impact        where the ball is as it reaches the bat (scene coordinates)
  //   ball          where the ball is now (scene coordinates)
  //   sinceEvent    seconds since the ball met the bat or broke the wicket
  //   animate       false under reduced motion: no head turn
  function pose(clock, shot = null) {
    if (geometry) restore(geometry); // undo the last frame's steer and head turn before the clip is posed
    state.lastSteer = null;
    const plan = shot ? batterClips(shot.animation, has) : { first: null };
    const { sinceArrival = 0, earliest = -Infinity, lineX = 0 } = shot ?? {};
    const start = plan.first ? Math.min(Math.max(-lead(plan.first), earliest), -0.05) : 0;
    if (!plan.first || sinceArrival < start) {
      rig.pose([{ clip: IDLE, time: clock }]);
      group.position.copy(home);
      return;
    }
    const first = plan.first;
    // before the ball arrives the clip is paced so that its contact frame lands on the arrival
    const into = sinceArrival < 0 ? lead(first) * (sinceArrival - start) / -start : lead(first) + sinceArrival;
    // the follow-up starts once the shot is done and, for a dismissal, not before the stumps break
    const eventInto = Number.isFinite(shot.sinceEvent) ? into - shot.sinceEvent : -Infinity;
    const handOver = Math.max(rig.duration(first), plan.thenAt === 'event' ? eventInto : -Infinity);
    // straight from one clip to the next: a cross-fade between two grips is not a grip, and pulls the hands off the bat
    rig.pose(plan.then && into >= handOver ? [{ clip: plan.then, time: into - handOver }] : [{ clip: first, time: into }]);
    // the root moves across from the stance as the shot comes, so the bat face meets the line
    const rootX = batterRootX(isLeave(first) ? 'leave' : 'play', lineX, reach);
    group.position.copy(home);
    group.position.x = THREE.MathUtils.lerp(home.x, rootX, clamp01(into / lead(first)));

    if (!geometry) return;
    const { contact } = shot.animation;
    const weight = contact && shot.impact ? steerWeight(sinceArrival) : 0;
    const looking = shot.animation.name === 'left-alone' && shot.animate !== false && shot.ball && shot.impact;
    if (weight > 0 || looking) snapshot(geometry);
    if (weight > 0) steerBat(weight, contact, shot.impact);
    // the clip's head watches the ball in; from the moment it passes him the head follows it on
    if (looking) follow(clamp01(sinceArrival / LOOK_IN), shot.ball, shot.impact);
  }

  // Where along the pitch (data y) the ball's centre is when it meets the face of the bat at the
  // forward defensive's contact frame: the play times the impact there, so the steer is across and up.
  let contactY = constants.bat_plane_y;
  if (geometry && rig.has('Forward_Defensive')) {
    rig.pose([{ clip: 'Forward_Defensive', time: contactTime }]);
    group.position.copy(home);
    group.position.x = batterRootX('play', 0.23, reach); // the corridor's middle
    group.updateMatrixWorld(true);
    contactY = -reference('face').ref[2] - constants.ball_radius; // scene -Z is data +y
    rig.played.clear(); // measuring is not showing: the clips shown are counted from here
  }

  // The shot's bat and arms at its contact frame, relative to the root (scene axes), as
  // planContact takes them: for checking in the browser and for the tests' fixture.
  function contactPose(kind) {
    if (!geometry) return null;
    restore(geometry);
    rig.pose([{ clip: kind === 'edge' && rig.has('Edge_Flash') ? 'Edge_Flash' : 'Forward_Defensive', time: contactTime }]);
    group.position.set(0, 0, 0);
    const pose = posed(kind);
    group.position.copy(home);
    return pose;
  }

  pose(0, null);
  return {
    group,
    pose,
    contactY,
    contactPose,
    clips: rig.played,
    // the last frame's steer, or null: { kind, weight, error (contact point to where it should meet
    // the ball, read back from the bones), limited (the arms could not reach), hands (each hand to
    // its grip), root (the body's shift [across, along]), residual (what was left, scene axes),
    // clearance (contact point to the ball's centre) }, distances in metres
    get lastSteer() { return state.lastSteer; },
    calibrated: Boolean(geometry),
  };
}

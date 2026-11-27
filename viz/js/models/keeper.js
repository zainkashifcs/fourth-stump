// The wicketkeeper (assets/keeper.glb): crouched behind the batter's stumps where
// the drawn path of a ball left or missed ends, the keeper's plane (geometry.js).
// Idle_Crouch loops; for a ball that goes through he plays Gather, timed so its
// take_time is the instant the ball reaches him, stepping across and rising with
// the ball and reaching for it with both arms (contact.js) so it lands in his
// gloves; on a dismissal he plays Celebrate. He is drawn on his own layer, which
// the behind-the-stumps camera leaves out (director.js, showsKeeper).
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { KEEPER_Y, keeperReach } from '../geometry.js';
import { twoBone } from '../contact.js';
import { createRig } from './rig.js';
import { placeholderFigure } from './placeholder.js';

export const KEEPER_LAYER = 1;
const IDLE = 'Idle_Crouch';
const GATHER = 'Gather';
const CELEBRATE = 'Celebrate';
const HOME_X = 0.25; // data x of his gloves between balls: on the fourth-stump line
const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
const smooth = (q) => { const c = Math.min(Math.max(q, 0), 1); return c * c * (3 - 2 * c); };
const arr = (v) => [v.x, v.y, v.z];

export function buildKeeper(gltf) {
  const group = new THREE.Group();
  const rig = gltf && createRig(gltf, [IDLE]);
  const figure = rig ? rig.root : placeholderFigure();
  group.add(figure);
  group.rotation.y = Math.PI; // the model faces +Z; he faces up the pitch
  figure.traverse((object) => {
    object.layers.set(KEEPER_LAYER);
    object.castShadow = false; // a shadow without its keeper would show from behind the stumps
  });
  const info = gltf?.scene.getObjectByName('keeper')?.userData ?? {};
  const takeTime = num(info.take_time, 0.3);
  const catchNode = figure.getObjectByName('catch') ?? figure;
  const has = (name) => Boolean(rig?.has(name));
  const show = (layers) => { if (rig) rig.pose(layers); };

  // Where his gloves are, relative to his root, crouched and at the take.
  const gloves = (layers) => {
    show(layers);
    group.position.set(0, 0, 0);
    group.updateMatrixWorld(true);
    return catchNode.getWorldPosition(new THREE.Vector3());
  };
  const crouched = gloves(has(IDLE) ? [{ clip: IDLE, time: 0 }] : []);
  const taking = has(GATHER) ? gloves([{ clip: GATHER, time: takeTime }]) : crouched.clone();
  const plane = toScene(0, KEEPER_Y, 0).z; // scene z of the keeper's plane
  const home = new THREE.Vector3(toScene(HOME_X, 0, 0).x - crouched.x, 0, plane - crouched.z);
  rig?.played.clear(); // measuring is not showing: the clips shown are counted from here

  const arms = ['L', 'R'].map((side) => ({ arm: rig?.node(`arm${side}`), fore: rig?.node(`fore${side}`) })).filter((a) => a.arm && a.fore);
  arms.forEach((a) => {
    a.upper = num(info.upper_arm, a.fore.position.length());
    a.forearm = num(info.forearm, 0.35);
    a.hand = new THREE.Vector3(0, a.forearm, 0); // a bone runs along its own +Y, elbow to hand
  });

  const v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion(), p: new THREE.Quaternion() };
  function aim(bone, local, want) {
    bone.getWorldQuaternion(v.p);
    v.a.copy(local).applyQuaternion(v.p).normalize();
    v.q.setFromUnitVectors(v.a, v.b.copy(want).normalize());
    v.p.premultiply(v.q);
    bone.parent.getWorldQuaternion(v.q).invert();
    bone.quaternion.copy(v.q.multiply(v.p));
    bone.updateMatrixWorld(true);
  }

  // Moves both hands by `shift` (world), each elbow bent the way the clip bends it.
  function reach(by) {
    const shift = by.clone(); // `by` may be a scratch vector the solve below reuses
    arms.forEach((a) => {
      const shoulder = a.arm.getWorldPosition(new THREE.Vector3());
      const elbow = a.fore.getWorldPosition(new THREE.Vector3());
      const hand = a.fore.localToWorld(a.hand.clone()).add(shift);
      const solved = twoBone(arr(shoulder), arr(hand), a.upper, a.forearm, arr(elbow));
      aim(a.arm, a.fore.position, new THREE.Vector3(...solved.elbow).sub(shoulder));
      aim(a.fore, a.hand, hand.sub(a.fore.getWorldPosition(v.c)));
    });
  }

  // Between his gloves: the midpoint of his hands once he has arms, else the `catch` marker. (The
  // `catch` bone hangs off his body, so it stays where the clip put it while his arms reach.)
  function between(target) {
    if (!arms.length) return catchNode.getWorldPosition(target);
    target.set(0, 0, 0);
    arms.forEach((a) => target.add(a.fore.localToWorld(v.b.copy(a.hand))));
    return target.divideScalar(arms.length);
  }

  // the mixer writes a bone only when the clip's value changes, so the reach is undone each frame
  const saved = arms.flatMap((a) => [a.arm, a.fore]).map((bone) => ({ bone, q: bone.quaternion.clone() }));
  let reached = false;
  const restore = () => {
    if (reached) saved.forEach(({ bone, q }) => bone.quaternion.copy(q));
    reached = false;
  };

  let holding = false;
  // mode: 'idle' | 'gather' | 'celebrate'. since: seconds from the ball reaching him (gather)
  // or from the dismissal (celebrate). ball: where it reaches him (scene). animate: false
  // under reduced motion, when he only crouches.
  function pose({ clock = 0, mode = 'idle', since = 0, ball = null, animate = true } = {}) {
    restore();
    holding = false;
    group.position.copy(home);
    if (!animate) {
      show(has(IDLE) ? [{ clip: IDLE, time: 0 }] : []);
      group.updateMatrixWorld(true);
      return;
    }
    if (mode === 'gather' && ball && since >= -takeTime) {
      const ramp = smooth((since + takeTime) / takeTime); // in step and rising as the ball comes
      show([{ clip: has(GATHER) ? GATHER : IDLE, time: has(GATHER) ? takeTime + since : clock }]);
      const { step, rise } = keeperReach(arr(ball), arr(home.clone().add(taking)));
      group.position.x += step * ramp;
      group.position.y += rise * ramp;
      group.updateMatrixWorld(true);
      if (arms.length) {
        saved.forEach((entry) => entry.q.copy(entry.bone.quaternion));
        reached = true;
        reach(new THREE.Vector3().copy(ball).sub(between(new THREE.Vector3())).multiplyScalar(ramp));
      }
      holding = since >= 0;
      return;
    }
    if (mode === 'celebrate' && since >= 0 && has(CELEBRATE)) show([{ clip: CELEBRATE, time: since }]);
    else show(has(IDLE) ? [{ clip: IDLE, time: clock }] : []);
    group.updateMatrixWorld(true);
  }

  pose();
  return {
    group,
    pose,
    gloves: (target) => between(target), // where a ball he has taken sits
    get holding() { return holding; },
    clips: rig?.played ?? [],
  };
}

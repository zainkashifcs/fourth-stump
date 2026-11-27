// The classic Test bowler (assets/bowler.glb). RunUp_Stride loops while the
// root runs in, Bound_And_Deliver takes over at a loop boundary, and the
// figure is stood so that the `release` bone is on the first point of the
// path at the clip's release time. The model is a right-armer; a left-armer
// is its mirror image, which puts the body on the other side of the stumps.
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { followThrough } from '../geometry.js';
import { createRig } from './rig.js';
import { placeholderFigure } from './placeholder.js';

const RUN = 'RunUp_Stride';
const DELIVER = 'Bound_And_Deliver';
const APPEAL = 'Appeal_Celebrate';
const RUN_SPEED = 6; // metres per second in the run-up
const BLEND = 0.1;
const hand = new THREE.Vector3();

export function buildBowler(gltf) {
  const group = new THREE.Group(); // the model faces +Z: down the pitch at the batter
  const rig = gltf && createRig(gltf, [RUN]);
  const animated = Boolean(rig?.has(DELIVER));
  const figure = animated ? rig.root : placeholderFigure();
  group.add(figure);
  const release = figure.getObjectByName('release') ?? figure;
  const timing = (animated && gltf.scene.getObjectByName('bowler')?.userData) || {};
  const releaseTime = Number(timing.release_time) || 0.55; // seconds into Bound_And_Deliver
  const plantTime = Number(timing.plant_time) || 0.45;
  const boundTravel = (RUN_SPEED * plantTime) / 2; // ground covered while slowing to the front-foot landing
  const stands = new Map();

  const show = (layers) => { if (animated) rig.pose(layers); };

  // Where the root goes, and at what size, for the hand to be on `point` at the release.
  // Sampled once per arm and release point.
  function stand(point, arm) {
    const key = `${arm}:${point.join(',')}`;
    if (!stands.has(key)) {
      const mirror = arm === 'left' ? -1 : 1;
      show([{ clip: DELIVER, time: releaseTime }]);
      group.position.set(0, 0, 0);
      group.scale.set(mirror, 1, 1);
      group.updateMatrixWorld(true);
      const size = THREE.MathUtils.clamp(point[2] / Math.max(release.getWorldPosition(hand).y, 0.5), 0.85, 1.3);
      group.scale.set(mirror * size, size, size);
      group.updateMatrixWorld(true);
      release.getWorldPosition(hand); // read before the group moves: reading refreshes its matrix
      stands.set(key, { origin: toScene(...point).sub(hand), size, mirror });
    }
    return stands.get(key);
  }

  // point: path[0] in data coordinates. sinceRelease: seconds from the ball
  // leaving the hand (negative during the approach). runUp: whether the
  // approach is shown. appealAt: when, on the same scale, the appeal starts.
  function pose({ point, arm, sinceRelease, runUp = false, appealAt = null }) {
    const { origin, size, mirror } = stand(point, arm);
    const into = releaseTime + sinceRelease; // seconds into Bound_And_Deliver
    let back = 0; // metres still to run, up the pitch from where the bowler delivers
    if (into < 0) {
      show([{ clip: RUN, time: into }]);
      back = boundTravel + RUN_SPEED * -into;
    } else if (appealAt != null && sinceRelease >= appealAt && rig?.has(APPEAL)) {
      const weight = THREE.MathUtils.clamp((sinceRelease - appealAt) / BLEND, 0, 1);
      show([{ clip: DELIVER, time: rig.duration(DELIVER), weight: 1 - weight }, { clip: APPEAL, time: sinceRelease - appealAt, weight }]);
    } else {
      show([{ clip: DELIVER, time: into }]);
      if (runUp && into < plantTime) back = boundTravel * (1 - into / plantTime) ** 2;
    }
    group.scale.set(mirror * size, size, size);
    group.position.copy(origin);
    group.position.z -= back; // scene -Z is up the pitch
    if (sinceRelease > 0) {
      const [x, y] = followThrough(sinceRelease, arm); // two strides on, peeling off the pitch
      group.position.x += x;
      group.position.z -= y;
    }
    group.updateMatrixWorld(true);
  }

  return {
    group,
    pose,
    handPosition: (target) => release.getWorldPosition(target),
    releaseTime,
    clips: rig?.played ?? [],
  };
}

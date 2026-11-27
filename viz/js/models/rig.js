// A skinned model with all its clips on one AnimationMixer. The page does not
// let the mixer run on its own clock: each view asks for the pose at a moment
// of its own delivery, so `pose` sets every clip's time and weight and has the
// mixer apply them. That keeps one batter, bowler and wicket shared between
// three panels, and lets reduced motion jump straight to a last frame.
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// loops: names of the clips that repeat; every other clip holds its last frame.
export function createRig(gltf, loops = []) {
  const root = clone(gltf.scene); // a skinned copy with its own skeleton
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();
  gltf.animations.forEach((clip) => {
    const looping = loops.includes(clip.name);
    const action = mixer.clipAction(clip);
    action.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
    action.setEffectiveWeight(0);
    actions.set(clip.name, { action, duration: clip.duration, looping });
  });
  const played = new Set(); // clips that have been shown, for checking in the browser

  // layers: [{ clip, time, weight = 1 }]. Weights should add up to 1; any
  // shortfall is filled by the pose the model was exported in.
  function pose(layers) {
    actions.forEach(({ action }) => action.setEffectiveWeight(0));
    layers.forEach(({ clip, time, weight = 1 }) => {
      const entry = actions.get(clip);
      if (!entry || weight <= 0) return;
      const { action, duration, looping } = entry;
      action.enabled = true;
      action.paused = false;
      action.time = looping ? ((time % duration) + duration) % duration : THREE.MathUtils.clamp(time, 0, duration - 1e-4);
      action.setEffectiveWeight(weight);
      played.add(clip);
    });
    mixer.update(0);
  }

  return {
    root,
    pose,
    played,
    has: (name) => actions.has(name),
    duration: (name) => actions.get(name)?.duration ?? 0,
    node: (name) => root.getObjectByName(name),
  };
}

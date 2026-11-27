// The classic Test batter (assets/batter.glb): a right-hander at the popping
// crease, side-on. The file holds three one-frame clips; this reads each
// clip's joint positions and rotations and blends from the stance to another.
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { placeholderBat, placeholderFigure } from './placeholder.js';

const GUARD_X = -0.3; // the line of the batter's feet in data x, outside leg stump
const CLIPS = { stance: 'stance', defend: 'forward_defensive', leave: 'shouldering_arms' };
const MAX_STEP_ACROSS = [-0.3, 0.35]; // how far the batter moves across the crease to reach the line, metres

// { clip name: Map(node -> { position, quaternion }) }, from the first key of every track
function readPoses(gltf) {
  const poses = {};
  gltf.animations.forEach((clip) => {
    const pose = new Map();
    clip.tracks.forEach((track) => {
      const dot = track.name.lastIndexOf('.');
      const node = gltf.scene.getObjectByName(track.name.slice(0, dot));
      const property = track.name.slice(dot + 1);
      if (!node || (property !== 'position' && property !== 'quaternion')) return;
      const entry = pose.get(node) ?? { position: node.position.clone(), quaternion: node.quaternion.clone() };
      entry[property].fromArray(track.values);
      pose.set(node, entry);
    });
    poses[clip.name] = pose;
  });
  return poses;
}

export function buildBatter(gltf, constants) {
  const group = new THREE.Group();
  const home = toScene(GUARD_X, constants.bat_plane_y, 0);
  group.position.copy(home);
  group.rotation.y = Math.PI / 2; // chest to the off side, left shoulder to the bowler

  const poses = gltf ? readPoses(gltf) : {};
  if (!gltf || !poses.stance) {
    group.add(placeholderFigure(), placeholderBat(constants.bat_half_width));
    return { group, setPose() {} };
  }
  group.add(gltf.scene);

  // the line (data x) the forward defensive is modelled on: where its bat comes down
  const bat = gltf.scene.getObjectByName('bat');
  const modelledLine = GUARD_X + (poses[CLIPS.defend]?.get(bat)?.position.z ?? 0.5);

  // action: 'stance' | 'defend' | 'leave'; amount 0..1 away from the stance; lineX: the ball's line in data x
  function setPose(action, amount, lineX = modelledLine) {
    const target = poses[CLIPS[action]] ?? poses.stance;
    poses.stance.forEach((rest, node) => {
      const to = target.get(node) ?? rest;
      node.position.lerpVectors(rest.position, to.position, amount);
      node.quaternion.slerpQuaternions(rest.quaternion, to.quaternion, amount);
    });
    const across = action === 'defend' ? THREE.MathUtils.clamp(lineX - modelledLine, ...MAX_STEP_ACROSS) * amount : 0;
    group.position.copy(home).x += across;
  }

  setPose('stance', 0);
  return { group, setPose };
}

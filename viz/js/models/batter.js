// The classic Test batter (assets/batter.glb): a right-hander at the popping
// crease, side-on. Idle_Stance loops until the batter commits; a shot clip is
// timed so its contact frame lands as the ball arrives, then holds its last frame.
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { createRig } from './rig.js';
import { placeholderBat, placeholderFigure } from './placeholder.js';

const GUARD_X = -0.3; // the line of the batter's feet in data x, outside leg stump
const IDLE = 'Idle_Stance';
const SHOTS = { defend: 'Forward_Defensive', edge: 'Edge_Flash', leave: 'Leave_Shoulder_Arms' };
const BLEND = 0.1; // seconds to cross-fade from the stance into a shot
const MAX_STEP_ACROSS = [-0.3, 0.35]; // how far the batter moves across the crease to reach the line, metres
const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

export function buildBatter(gltf, constants) {
  const group = new THREE.Group();
  const home = toScene(GUARD_X, constants.bat_plane_y, 0);
  group.position.copy(home);
  group.rotation.y = Math.PI / 2; // chest to the off side, left shoulder to the bowler

  const rig = gltf && createRig(gltf, [IDLE]);
  if (!rig?.has(IDLE)) {
    group.add(placeholderFigure(), placeholderBat(constants.bat_half_width));
    return { group, pose() {}, clips: [] };
  }
  group.add(rig.root);

  // seconds into Forward_Defensive and Edge_Flash at which the bat meets the ball, from the file
  const contactTime = Number(gltf.scene.getObjectByName('batter')?.userData.contact_time) || 0.3;
  const lead = (kind) => (kind === 'leave' ? rig.duration(SHOTS.leave) * 0.75 : contactTime);

  // the line (data x) each contact shot is modelled on: where its bat is at contact
  const bat = rig.node('bat');
  const modelledLine = {};
  ['defend', 'edge'].forEach((kind) => {
    if (!bat || !rig.has(SHOTS[kind])) return;
    rig.pose([{ clip: SHOTS[kind], time: contactTime }]);
    group.updateMatrixWorld(true);
    modelledLine[kind] = bat.getWorldPosition(new THREE.Vector3()).x;
  });

  // clock: seconds for the idle loop. kind: 'defend' | 'edge' | 'leave' | null.
  // sinceArrival: seconds since the ball reached the bat (negative before).
  // earliest: the first moment, on the same scale, at which the batter may move.
  // lineX: the line of the ball in data x.
  function pose(clock, kind, sinceArrival = 0, earliest = -Infinity, lineX = 0) {
    const clip = SHOTS[kind];
    const start = Math.min(Math.max(-lead(kind), earliest), -0.05);
    if (!clip || !rig.has(clip) || sinceArrival < start) {
      rig.pose([{ clip: IDLE, time: clock }]);
      group.position.copy(home);
      return;
    }
    // before the ball arrives the clip is paced so that its contact frame lands on the arrival
    const into = sinceArrival < 0 ? lead(kind) * (sinceArrival - start) / -start : lead(kind) + sinceArrival;
    const weight = clamp01((sinceArrival - start) / BLEND);
    rig.pose([{ clip: IDLE, time: clock, weight: 1 - weight }, { clip, time: into, weight }]);
    const reach = modelledLine[kind] == null ? 0 : THREE.MathUtils.clamp(lineX - modelledLine[kind], ...MAX_STEP_ACROSS);
    group.position.copy(home).x += reach * clamp01(into / lead(kind));
  }

  pose(0, null);
  return { group, pose, clips: rig.played };
}

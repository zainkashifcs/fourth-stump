// The classic Test batter (assets/batter.glb): a right-hander at the popping
// crease, side-on, standing on the leg side with his chest to the off side.
// Idle_Stance loops until the batter commits; a shot clip is timed so its
// contact frame lands as the ball arrives, then holds its last frame.
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { STANCE_X, batterRootX } from '../geometry.js';
import { createRig } from './rig.js';
import { placeholderBat, placeholderFigure } from './placeholder.js';

const IDLE = 'Idle_Stance';
const SHOTS = { defend: 'Forward_Defensive', edge: 'Edge_Flash', leave: 'Leave_Shoulder_Arms' };
const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

export function buildBatter(gltf, constants) {
  const group = new THREE.Group();
  const home = toScene(STANCE_X, constants.bat_plane_y, 0);
  group.position.copy(home);
  group.rotation.y = Math.PI / 2; // chest to the off side, left shoulder to the bowler: rig +Z is data +x

  const rig = gltf && createRig(gltf, [IDLE]);
  if (!rig?.has(IDLE)) {
    group.add(placeholderFigure(), placeholderBat(constants.bat_half_width));
    return { group, pose() {}, clips: [] };
  }
  group.add(rig.root);

  // from the file: contact_time, seconds into Forward_Defensive and Edge_Flash at which the bat meets
  // the ball; bat_line, rig Z of the middle of the bat face at contact; body_edge, the largest rig Z
  // that head, torso, legs and pads reach
  const info = gltf.scene.getObjectByName('batter')?.userData ?? {};
  const contactTime = Number(info.contact_time) || 0.3;
  const reach = { batLine: Number(info.bat_line) || 0.7, bodyEdge: Number(info.body_edge) || 0.25, ballRadius: constants.ball_radius };
  const lead = (kind) => (kind === 'leave' ? rig.duration(SHOTS.leave) * 0.75 : contactTime);

  // clock: seconds for the idle loop. kind: 'defend' | 'edge' | 'leave' | null.
  // sinceArrival: seconds since the ball reached the bat (negative before).
  // earliest: the first moment, on the same scale, at which the batter may move.
  // lineX: the line, in data x, the bat goes to.
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
    // straight from the stance into the shot: a cross-fade between two grips is not a grip, and pulls the hands off the bat
    rig.pose([{ clip, time: into }]);
    // the root moves across from the stance as the shot comes, so the bat face meets the line
    const rootX = batterRootX(kind === 'leave' ? 'leave' : 'play', lineX, reach);
    group.position.copy(home);
    group.position.x = THREE.MathUtils.lerp(home.x, rootX, clamp01(into / lead(kind)));
  }

  pose(0, null);
  return { group, pose, clips: rig.played };
}

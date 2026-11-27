// The fielders, each crouched on a looping Idle_Crouch. First slip
// (assets/slip.glb) stands behind the batter's wicket; the empty called
// `catch` between the hands is where an edge that carries ends up. A ring
// fielder (assets/fielder.glb) stands at cover, facing the batter.
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { COVER, STANCE_X } from '../geometry.js';
import { createRig } from './rig.js';
import { placeholderFigure } from './placeholder.js';

const IDLE = 'Idle_Crouch';
const SLIP = [1.6, -4.8]; // data x, y: just out of the default shot, so it is never half in frame

// spot: [x, y] in data coordinates. turn: rotation about the vertical; the model faces +Z.
function buildFielder(gltf, spot, turn) {
  const group = new THREE.Group();
  const rig = gltf && createRig(gltf, [IDLE]);
  const figure = rig ? rig.root : placeholderFigure();
  group.add(figure);
  group.position.copy(toScene(spot[0], spot[1], 0));
  group.rotation.y = turn;
  const pose = (clock) => { if (rig?.has(IDLE)) rig.pose([{ clip: IDLE, time: clock }]); };
  pose(0);
  group.updateMatrixWorld(true);
  return { group, figure, pose, clips: rig?.played ?? [] };
}

export function buildSlip(gltf) {
  const fielder = buildFielder(gltf, SLIP, Math.PI + 0.25); // facing up the pitch, angled in at the bat
  const catchPoint = (fielder.figure.getObjectByName('catch') ?? fielder.figure).getWorldPosition(new THREE.Vector3());
  return { ...fielder, catchPoint };
}

export function buildRingFielder(gltf, constants) {
  const at = toScene(...COVER, 0);
  const batter = toScene(STANCE_X, constants.bat_plane_y, 0);
  return buildFielder(gltf, COVER, Math.atan2(batter.x - at.x, batter.z - at.z));
}

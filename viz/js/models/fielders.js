// First slip (assets/slip.glb), crouched behind the batter's wicket. The empty
// called `catch` between the hands is where an edge that carries ends up.
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { placeholderFigure } from './placeholder.js';

const SLIP = [1.6, -4.8]; // data x, y: just out of the default shot, so it is never half in frame

export function buildSlip(gltf) {
  const group = new THREE.Group();
  const figure = gltf ? gltf.scene : placeholderFigure();
  group.add(figure);
  group.position.copy(toScene(SLIP[0], SLIP[1], 0));
  group.rotation.y = Math.PI + 0.25; // facing up the pitch, angled in at the bat
  group.updateMatrixWorld(true);
  const catchPoint = (figure.getObjectByName('catch') ?? figure).getWorldPosition(new THREE.Vector3());
  return { group, catchPoint };
}

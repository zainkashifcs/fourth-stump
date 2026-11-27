// Plain stand-ins, drawn only when a .glb fails to load.
import * as THREE from 'three';
import { KIT, box, flat, part } from './materials.js';

function marker(name, x, y, z) {
  const object = new THREE.Object3D();
  object.name = name;
  object.position.set(x, y, z);
  return object;
}

// A block figure in whites, facing +Z, with the markers the page looks for.
export function placeholderFigure() {
  const figure = new THREE.Group();
  figure.add(
    part(box(0.3, 0.9, 0.2), flat(KIT.sweater), 0, 0.45, 0),
    part(box(0.42, 0.55, 0.22), flat(KIT.sweater), 0, 1.17, 0),
    part(box(0.18, 0.2, 0.18), flat(KIT.skin), 0, 1.57, 0),
    part(box(0.2, 0.06, 0.2), flat(KIT.navy), 0, 1.7, 0),
    marker('release', -0.25, 2.0, 0.1),
    marker('catch', 0, 0.6, 0.35),
  );
  return figure;
}

export function placeholderBat(halfWidth) {
  return part(box(2 * halfWidth, 0.86, 0.04), flat(KIT.willow), 0.05, 0.45, 0.34);
}

export function placeholderBackdrop() {
  const stand = part(box(60, 9, 8), flat(0x9aa3a8), 0, 4.5, 0);
  stand.castShadow = false;
  return stand;
}

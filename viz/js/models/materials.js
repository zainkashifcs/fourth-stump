// Shared flat-shaded materials and low-polygon geometries. Everything here is
// cached and reused across models, so nothing built from it is ever disposed.
import * as THREE from 'three';

const materials = new Map();
const geometries = new Map();

export function flat(color, options = {}) {
  const key = `${color}:${JSON.stringify(options)}`;
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...options }));
  }
  return materials.get(key);
}

function cached(key, make) {
  if (!geometries.has(key)) geometries.set(key, make());
  return geometries.get(key);
}

export const box = (w, h, d) => cached(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));

export const cylinder = (top, bottom, height, sides = 6) =>
  cached(`c:${top}:${bottom}:${height}:${sides}`, () => new THREE.CylinderGeometry(top, bottom, height, sides));

export function part(geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const KIT = { sweater: 0xf2ead0, navy: 0x1c2a55, skin: 0xd8a47e, willow: 0xe6d29c, ash: 0xf3e3b4 };

// A stylised right-handed batter built from primitives, standing side-on at
// the popping crease: front shoulder to the bowler, chest to the off side (+x).
import * as THREE from 'three';
import { toScene } from './coords.js';

const UP = new THREE.Vector3(0, 1, 0);

// A capsule between two points given in data coordinates.
function limb(from, to, radius, material) {
  const a = toScene(...from);
  const b = toScene(...to);
  const span = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, span.length(), 6, 14), material);
  mesh.position.copy(a).addScaledVector(span, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, span.normalize());
  return mesh;
}

function blob(geometry, material, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(toScene(...position));
  return mesh;
}

export function buildBatter({ bat_half_width: batHalfWidth }, creaseY) {
  const whites = new THREE.MeshStandardMaterial({ color: 0xe9e6d8, roughness: 0.9 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0x1b2a4a, roughness: 0.5 });
  const willow = new THREE.MeshStandardMaterial({ color: 0xd9bf85, roughness: 0.7 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });

  const back = creaseY - 0.3; // back foot behind the popping crease
  const front = creaseY + 0.25;
  const x = -0.32; // feet outside leg stump, so the wicket stays in view
  const hands = [x + 0.2, back + 0.08, 0.84];
  const toe = [x + 0.22, back - 0.12, 0.03];

  const torso = limb([x, creaseY - 0.03, 0.92], [x + 0.1, creaseY + 0.02, 1.42], 0.15, whites);
  torso.scale.set(0.8, 1, 1.25); // side-on: narrow across, broad along the pitch

  const bladeFrom = new THREE.Vector3(...hands).lerp(new THREE.Vector3(...toe), 0.32).toArray();
  const blade = limb(bladeFrom, toe, 0.02, willow);
  blade.geometry.dispose();
  const bladeLength = new THREE.Vector3(...bladeFrom).distanceTo(new THREE.Vector3(...toe));
  blade.geometry = new THREE.BoxGeometry(2 * batHalfWidth, bladeLength, 0.045);

  const peak = blob(new THREE.BoxGeometry(0.17, 0.02, 0.1), helmet, [x + 0.17, creaseY + 0.2, 1.63]);

  const batter = new THREE.Group();
  batter.add(
    blob(new THREE.BoxGeometry(0.27, 0.07, 0.1), whites, [x + 0.06, back, 0.035]),
    blob(new THREE.BoxGeometry(0.27, 0.07, 0.1), whites, [x + 0.06, front, 0.035]),
    limb([x, back, 0.12], [x, creaseY - 0.12, 0.86], 0.085, whites),
    limb([x, front, 0.12], [x, creaseY + 0.08, 0.86], 0.085, whites),
    torso,
    limb([x + 0.12, creaseY + 0.2, 1.4], hands, 0.05, whites),
    limb([x + 0.12, creaseY - 0.2, 1.38], hands, 0.05, whites),
    blob(new THREE.SphereGeometry(0.125, 20, 14), helmet, [x + 0.17, creaseY + 0.07, 1.64]),
    peak,
    limb(hands, bladeFrom, 0.017, grip),
    blade,
  );
  batter.traverse((part) => {
    if (part.isMesh) Object.assign(part, { castShadow: true, receiveShadow: true });
  });
  return batter;
}

// The puff at the bat: a few dozen points thrown off where the ball meets it,
// pale willow dust off a middled ball and a brief seam-coloured flash off an
// edge. One pool of points, posed as a function of time like everything else on
// the stage, so a frame only rewrites the positions already allocated.
import * as THREE from 'three';

const COUNT = 36;
const KINDS = {
  dust: { color: 0xf3ead0, seconds: 0.2, speed: 1.1, size: 0.07 }, // seen from 7 m, a few pixels each
  flash: { color: 0xfffaf0, seconds: 0.12, speed: 1.8, size: 0.09 },
};
const GRAVITY = -3;

export function buildBurst() {
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < COUNT; i += 1) {
    // a hemisphere of directions, thrown back towards the bowler and up (scene -Z, +Y)
    const theta = random() * Math.PI * 2;
    const up = random();
    const r = Math.sqrt(1 - up * up);
    const speed = 0.4 + 0.6 * random();
    velocities.set([r * Math.cos(theta) * speed, up * speed, -Math.abs(r * Math.sin(theta)) * speed], 3 * i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ size: 0.035, transparent: true, depthWrite: false, sizeAttenuation: true });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // its bounds move every frame
  points.visible = false;

  // kind: 'dust' | 'flash' | null. since: seconds from the contact. origin: where it happened (scene).
  function pose(kind, since, origin) {
    const style = KINDS[kind];
    if (!style || !(since >= 0) || since > style.seconds || !origin) {
      points.visible = false;
      return;
    }
    const k = since * style.speed;
    for (let i = 0; i < COUNT; i += 1) {
      positions[3 * i] = origin.x + velocities[3 * i] * k;
      positions[3 * i + 1] = origin.y + velocities[3 * i + 1] * k + 0.5 * GRAVITY * since * since;
      positions[3 * i + 2] = origin.z + velocities[3 * i + 2] * k;
    }
    geometry.attributes.position.needsUpdate = true;
    material.color.setHex(style.color);
    material.size = style.size;
    material.opacity = 1 - since / style.seconds;
    points.visible = true;
  }

  return { group: points, pose };
}

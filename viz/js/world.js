// The static ground in flat colours: mown outfield, pitch, creases, the
// fourth-stump corridor, the boundary and daylight. Positions are written in
// data coordinates and converted by coords.js.
import * as THREE from 'three';
import { toScene } from './coords.js';
import { flat as flatMaterial } from './models/materials.js';

// Laws of Cricket dimensions that the data file does not carry (metres).
const LAWS = {
  poppingCrease: 1.22, // in front of the stumps
  pitchWidth: 3.05,
  returnCreaseX: 1.32,
  returnCreaseLength: 2.44,
  bowlingCreaseLength: 2.64,
  creaseLine: 0.05,
};

const BOUNDARY = 76; // radius in metres, from the middle of the pitch
const OUTFIELD = 130; // radius of the grass, past the stands (about 90 m from the stumps) so no sky shows under them
const STRIPE = 7;

// A flat rectangle lying on the ground, `width` across (x) and `length` up the pitch (y).
function flat(width, length, material, x, y, lift) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(toScene(x, y, lift));
  mesh.receiveShadow = true;
  return mesh;
}

function buildGround(pitchLength) {
  const group = new THREE.Group();
  const middle = pitchLength / 2;
  const outfield = new THREE.Mesh(new THREE.CircleGeometry(OUTFIELD, 48), flatMaterial(0x3f8f47));
  outfield.rotation.x = -Math.PI / 2;
  outfield.position.copy(toScene(0, middle, 0));
  outfield.receiveShadow = true;
  group.add(outfield);
  // mowing stripes, each cut to the boundary circle
  const lighter = flatMaterial(0x4a9c50);
  for (let x = -BOUNDARY + STRIPE; x < BOUNDARY - STRIPE; x += 2 * STRIPE) {
    const centre = x + STRIPE / 2;
    const reach = Math.sqrt(BOUNDARY * BOUNDARY - Math.max(Math.abs(x), Math.abs(x + STRIPE)) ** 2);
    group.add(flat(STRIPE, 2 * reach, lighter, centre, middle, 0.002));
  }
  group.add(flat(LAWS.pitchWidth, pitchLength + 2 * LAWS.returnCreaseLength, flatMaterial(0xc9b27a), 0, middle, 0.005));
  return group;
}

function buildCreases(pitchLength) {
  const group = new THREE.Group();
  const white = flatMaterial(0xffffff);
  const lift = 0.009;
  // direction is +1 at the batter's end and -1 at the bowler's end
  [[0, 1], [pitchLength, -1]].forEach(([stumpsY, direction]) => {
    const poppingY = stumpsY + direction * LAWS.poppingCrease;
    const returnY = poppingY - direction * (LAWS.returnCreaseLength / 2);
    group.add(
      flat(LAWS.bowlingCreaseLength, LAWS.creaseLine, white, 0, stumpsY, lift),
      flat(LAWS.pitchWidth, LAWS.creaseLine, white, 0, poppingY, lift),
      flat(LAWS.creaseLine, LAWS.returnCreaseLength, white, LAWS.returnCreaseX, returnY, lift),
      flat(LAWS.creaseLine, LAWS.returnCreaseLength, white, -LAWS.returnCreaseX, returnY, lift),
    );
  });
  return group;
}

// The corridor as a band on the pitch, plus a ghost "fourth stump" at the wicket.
function buildCorridor({ corridor_min: min, corridor_max: max, pitch_length: length, stump_height: height }) {
  const group = new THREE.Group();
  const material = (opacity) =>
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false });
  const band = flat(max - min, length, material(0.3), (min + max) / 2, length / 2, 0.013);
  band.receiveShadow = false;
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(max - min, height, 0.03), material(0.3));
  ghost.position.copy(toScene((min + max) / 2, 0, height / 2));
  group.add(band, ghost);
  return group;
}

function buildBoundary(pitchLength) {
  const group = new THREE.Group();
  const centre = toScene(0, pitchLength / 2, 0);
  const ring = (inner, outer, height, y, color) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(outer, inner, height, 40, 1, true),
      flatMaterial(color, { side: THREE.BackSide }),
    );
    mesh.position.set(centre.x, y + height / 2, centre.z);
    group.add(mesh);
  };
  ring(BOUNDARY, BOUNDARY, 0.9, 0, 0xf5f3ea); // boundary boards
  ring(BOUNDARY + 1, BOUNDARY + 18, 5.5, 0.9, 0x6d8a72); // grass bank and seating behind
  return group;
}

function buildLights(pitchLength) {
  const group = new THREE.Group();
  group.add(new THREE.HemisphereLight(0xffffff, 0x8fae84, 1.5));
  const sun = new THREE.DirectionalLight(0xfff3d9, 2.1);
  const aim = [0, pitchLength * 0.42, 0];
  sun.position.copy(toScene(aim[0] - 28, aim[1] - 36, 44)); // behind the camera, so the backdrops' fronts are lit
  sun.target.position.copy(toScene(...aim));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 10, far: 130 });
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 2;
  group.add(sun, sun.target);
  return group;
}

// boundary: draw the plain boards and bank, for when the stadium model is missing.
export function buildWorld(constants, { boundary = true } = {}) {
  const length = constants.pitch_length;
  const world = new THREE.Group();
  world.add(
    buildGround(length),
    buildCreases(length),
    buildCorridor(constants),
    buildLights(length),
  );
  if (boundary) world.add(buildBoundary(length));
  return world;
}

// The static, procedural ground: outfield, pitch, creases, both wickets, the
// fourth-stump corridor, stands and floodlights. Positions are written in data
// coordinates and converted by coords.js.
import * as THREE from 'three';
import { toScene } from './coords.js';
import { buildBatter } from './batter.js';

// Laws of Cricket dimensions that the data file does not carry (metres).
const LAWS = {
  poppingCrease: 1.22, // in front of the stumps
  pitchWidth: 3.05,
  returnCreaseX: 1.32,
  returnCreaseLength: 2.44,
  bowlingCreaseLength: 2.64,
  creaseLine: 0.05,
  stumpRadius: 0.0175,
  bailRadius: 0.009,
};

export const NIGHT = 0x0b1712;

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function speckle(ctx, size, count, colours) {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = colours[i % colours.length];
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
}

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
  const mown = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#1f5a33';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#246539';
    ctx.fillRect(0, 0, size / 2, size);
    speckle(ctx, size, 1500, ['rgba(255,255,255,0.03)', 'rgba(0,0,0,0.05)']);
  });
  mown.repeat.set(14, 14);
  const outfield = new THREE.Mesh(
    new THREE.CircleGeometry(95, 72),
    new THREE.MeshStandardMaterial({ map: mown, roughness: 1 }),
  );
  outfield.rotation.x = -Math.PI / 2;
  outfield.position.copy(toScene(0, pitchLength / 2, 0));
  outfield.receiveShadow = true;

  const straw = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#ad9763';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 2600, ['rgba(255,255,255,0.06)', 'rgba(70,50,20,0.07)']);
  });
  straw.repeat.set(1, 7);
  const pitch = flat(
    LAWS.pitchWidth,
    pitchLength + 2 * LAWS.returnCreaseLength,
    new THREE.MeshStandardMaterial({ map: straw, roughness: 1 }),
    0, pitchLength / 2, 0.004,
  );
  group.add(outfield, pitch);
  return group;
}

function buildCreases(pitchLength) {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0e6, roughness: 1 });
  const lift = 0.008;
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

function buildWicket(y, { stump_half_width: halfWidth, stump_height: height }) {
  const group = new THREE.Group();
  const ash = new THREE.MeshStandardMaterial({ color: 0xfff6d8, roughness: 0.5, emissive: 0x4d4024 });
  const outer = halfWidth - LAWS.stumpRadius; // the off stump's outer edge sits at stump_half_width
  const stump = new THREE.CylinderGeometry(LAWS.stumpRadius, LAWS.stumpRadius, height, 14);
  [-outer, 0, outer].forEach((x) => {
    const mesh = new THREE.Mesh(stump, ash);
    mesh.position.copy(toScene(x, y, height / 2));
    mesh.castShadow = true;
    group.add(mesh);
  });
  const bail = new THREE.CylinderGeometry(LAWS.bailRadius, LAWS.bailRadius, outer * 0.96, 8);
  bail.rotateZ(Math.PI / 2);
  [-outer / 2, outer / 2].forEach((x) => {
    const mesh = new THREE.Mesh(bail, ash);
    mesh.position.copy(toScene(x, y, height + LAWS.bailRadius));
    mesh.castShadow = true;
    group.add(mesh);
  });
  return group;
}

// The corridor as a band on the pitch, plus a ghost "fourth stump" at the wicket.
function buildCorridor({ corridor_min: min, corridor_max: max, pitch_length: length, stump_height: height }) {
  const group = new THREE.Group();
  const material = (opacity) =>
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false });
  const band = flat(max - min, length, material(0.3), (min + max) / 2, length / 2, 0.012);
  band.receiveShadow = false;
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(max - min, height, 0.03), material(0.24));
  ghost.position.copy(toScene((min + max) / 2, 0, height / 2));
  group.add(band, ghost);
  return group;
}

function buildStadium(pitchLength) {
  const group = new THREE.Group();
  const centre = toScene(0, pitchLength / 2, 0);
  const crowd = canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#0d1a16';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 900, ['#263a35', '#1b2c2a', '#34483f', '#3d3a2e']);
    ctx.fillStyle = '#0a1411';
    ctx.fillRect(0, 0, size, size * 0.18);
  });
  crowd.repeat.set(24, 1);
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(98, 92, 20, 72, 1, true),
    new THREE.MeshBasicMaterial({ map: crowd, side: THREE.BackSide }),
  );
  stand.position.set(centre.x, 10, centre.z);
  group.add(stand);

  const screen = new THREE.MeshBasicMaterial({ color: 0x7f8a80 });
  [-68, pitchLength + 68].forEach((y) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(16, 5.5, 0.4), screen);
    mesh.position.copy(toScene(0, y, 2.75));
    group.add(mesh);
  });
  return group;
}

// Four floodlight towers: every object throws the crossed shadows of a day-night Test.
function buildLights(pitchLength) {
  const group = new THREE.Group();
  group.add(new THREE.HemisphereLight(0xcfdcff, 0x16301f, 0.75));
  const pole = new THREE.MeshBasicMaterial({ color: 0x1c2b27 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff6dc, fog: false });
  const aim = toScene(0, pitchLength * 0.3, 0);
  const towers = [[70, -45, true], [-70, pitchLength + 45, true], [-70, -45, false], [70, pitchLength + 45, false]];
  towers.forEach(([x, y, shadow]) => {
    const light = new THREE.DirectionalLight(0xfff4e0, shadow ? 1.15 : 0.6);
    light.position.copy(toScene(x, y, 48));
    light.target.position.copy(aim);
    if (shadow) {
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      Object.assign(light.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 40, far: 180 });
      light.shadow.bias = -0.0004;
      light.shadow.radius = 5;
    }
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 48, 1.2), pole);
    mast.position.copy(toScene(x * 1.25, y < 0 ? y - 25 : y + 25, 24));
    const head = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 1), lamp);
    head.position.copy(mast.position).setY(49);
    head.lookAt(aim.x, 20, aim.z);
    group.add(light, light.target, mast, head);
  });
  return group;
}

export function buildWorld(constants) {
  const length = constants.pitch_length;
  const world = new THREE.Group();
  world.add(
    buildGround(length),
    buildCreases(length),
    buildWicket(0, constants),
    buildWicket(length, constants),
    buildCorridor(constants),
    buildBatter(constants, LAWS.poppingCrease),
    buildStadium(length),
    buildLights(length),
  );
  return world;
}

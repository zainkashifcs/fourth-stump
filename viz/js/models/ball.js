// A glossy crimson ball with a stitched white seam (the one texture on the
// page, drawn onto a canvas) and a soft glow shell around it.
import * as THREE from 'three';

// Drawn larger than life so the seam stays visible from behind the stumps.
// The end-on chart draws the ball at its true size.
export const BALL_VISUAL_SCALE = 2;

function seamTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c4102a';
  ctx.fillRect(0, 0, 256, 128);
  // the seam runs round the equator: a white band with a row of stitches each side
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 55, 256, 18);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  for (let x = 0; x < 256; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, 42);
    ctx.lineTo(x + 5, 53);
    ctx.moveTo(x, 86);
    ctx.lineTo(x + 5, 75);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildBall(radius) {
  const size = radius * BALL_VISUAL_SCALE;
  const geometry = new THREE.SphereGeometry(size, 20, 14);
  geometry.rotateZ(Math.PI / 2); // stand the seam upright, pointing down the pitch
  const spin = new THREE.Mesh(
    geometry,
    new THREE.MeshPhongMaterial({ map: seamTexture(), shininess: 120, specular: 0xffffff, emissive: 0x4a0612 }),
  );
  spin.castShadow = true;

  const glow = (scale, opacity) => {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(size * scale, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xff3350, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    return shell;
  };

  const group = new THREE.Group();
  group.rotation.y = 0.35; // seam angled, as for a swing delivery
  group.add(spin, glow(1.45, 0.22), glow(1.95, 0.1));
  return { group, spin, lift: radius * (BALL_VISUAL_SCALE - 1) };
}

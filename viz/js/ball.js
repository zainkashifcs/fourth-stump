// A red ball with a stitched white seam, drawn onto a canvas texture.
import * as THREE from 'three';

// Drawn larger than life so the seam stays visible from behind the stumps.
// The end-on chart draws the ball at its true size.
export const BALL_VISUAL_SCALE = 1.6;

function seamTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#a3161f';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#8c1019';
  ctx.fillRect(0, 0, 256, 30);
  ctx.fillRect(0, 98, 256, 30);
  // the seam runs round the equator: a pale band with a row of stitches each side
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(0, 56, 256, 16);
  ctx.strokeStyle = '#f4efe2';
  ctx.lineWidth = 3;
  for (let x = 0; x < 256; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 46);
    ctx.lineTo(x + 4, 54);
    ctx.moveTo(x, 82);
    ctx.lineTo(x + 4, 74);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeBall(radius) {
  const geometry = new THREE.SphereGeometry(radius * BALL_VISUAL_SCALE, 28, 20);
  geometry.rotateZ(Math.PI / 2); // stand the seam upright, pointing down the pitch
  const spin = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ map: seamTexture(), roughness: 0.35, emissive: 0x3a0508 }),
  );
  spin.castShadow = true;
  const ball = new THREE.Group();
  ball.rotation.y = 0.35; // seam angled, as for a swing delivery
  ball.add(spin);
  return { ball, spin };
}

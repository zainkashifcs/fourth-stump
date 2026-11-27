// One delivery in the scene: the path drawn so far, the faint fan of sampled
// paths, a bounce mark, and the ball. `setProgress(u)` takes a position along
// the path measured in path points (0 = release, last = the batter's stumps).
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { pointToScene, toScene } from './coords.js';
import { BALL_VISUAL_SCALE, makeBall } from './ball.js';

const SUBDIVISIONS = 4; // extra points per path step, so the drawn tip keeps up with the ball

function fatLine(points, options) {
  const geometry = new LineGeometry();
  geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  return new Line2(geometry, new LineMaterial(options));
}

function subdivide(points) {
  const dense = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let s = 0; s < SUBDIVISIONS; s += 1) {
      dense.push(points[i].clone().lerp(points[i + 1], s / SUBDIVISIONS));
    }
  }
  dense.push(points[points.length - 1]);
  return dense;
}

export function makeDelivery({ path, fan = [], bounceIndex, color, ballRadius }) {
  const points = path.map(pointToScene);
  const last = points.length - 1;
  const group = new THREE.Group();

  const fanLines = fan.map((sample) =>
    fatLine(sample.map(pointToScene), { color, linewidth: 1.2, transparent: true, opacity: 0.3, depthWrite: false }));
  const line = fatLine(subdivide(points), { color, linewidth: 3.5 });
  const { ball, spin } = makeBall(ballRadius);
  const lift = ballRadius * (BALL_VISUAL_SCALE - 1); // keeps the enlarged ball from sinking into the pitch at the bounce

  const bounce = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.1, 28),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  bounce.rotation.x = -Math.PI / 2;
  if (bounceIndex >= 0) bounce.position.copy(points[Math.min(bounceIndex, last)]).setY(0.016);

  // a plumb line under the ball once it reaches the plane of the stumps
  const [endX, endY, endZ] = path[last];
  const plumb = fatLine([toScene(endX, endY, 0), toScene(endX, endY, endZ)], { color, linewidth: 1.5 });

  group.add(...fanLines, line, bounce, plumb, ball);

  function setProgress(u) {
    const clamped = Math.min(Math.max(u, 0), last);
    const index = Math.min(Math.floor(clamped), last - 1);
    ball.position.lerpVectors(points[index], points[index + 1], clamped - index);
    ball.position.y += lift;
    spin.rotation.x = -clamped * 0.8;
    line.geometry.instanceCount = Math.round(clamped * SUBDIVISIONS);
    bounce.visible = bounceIndex >= 0 && clamped >= bounceIndex;
    plumb.visible = clamped >= last;
  }

  function dispose() {
    group.removeFromParent();
    group.traverse((object) => {
      object.geometry?.dispose();
      object.material?.map?.dispose();
      object.material?.dispose();
    });
  }

  setProgress(0);
  return { group, last, setProgress, dispose };
}

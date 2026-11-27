// Three pale ash stumps and two bails. `setBreak` poses the wicket anywhere
// between intact (0) and broken (1): the stump nearest the ball is knocked
// back and the bails jump, spin and fall.
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { KIT, cylinder, flat, part } from './materials.js';

const STUMP_RADIUS = 0.019;
const BAIL_RADIUS = 0.018; // stouter than life, like the ball, so they can be seen flying

export function buildWicket({ stump_half_width: halfWidth, stump_height: height }, y) {
  const group = new THREE.Group();
  group.position.copy(toScene(0, y, 0));
  const ash = flat(KIT.ash);
  const outer = halfWidth - STUMP_RADIUS; // the off stump's outer edge sits at stump_half_width
  const xs = [-outer, 0, outer];

  const stumps = xs.map((x) => {
    const pivot = new THREE.Group(); // turns about the base of the stump
    pivot.position.set(x, 0, 0);
    pivot.add(part(cylinder(STUMP_RADIUS, STUMP_RADIUS, height, 6), ash, 0, height / 2, 0));
    group.add(pivot);
    return pivot;
  });

  const bailGeometry = cylinder(BAIL_RADIUS, BAIL_RADIUS, outer * 0.96, 5);
  const bails = [-outer / 2, outer / 2].map((x) => {
    const bail = part(bailGeometry, flat(0xcf9f52), x, height + BAIL_RADIUS, 0);
    group.add(bail);
    return { mesh: bail, x };
  });

  function setBreak(amount, hitX = 0) {
    const w = THREE.MathUtils.clamp(amount, 0, 1);
    const hit = xs.reduce((best, x, index) => (Math.abs(x - hitX) < Math.abs(xs[best] - hitX) ? index : best), 0);
    const settle = 1 - (1 - w) * (1 - w);
    stumps.forEach((stump, index) => {
      const struck = index === hit;
      // rotation.z > 0 tips the top towards -x: the struck stump goes away from the ball, its neighbours splay
      const lean = struck ? Math.sign(hitX - xs[hit]) || 1 : -Math.sign(xs[index] - xs[hit]);
      stump.rotation.x = settle * (struck ? 0.8 : 0.1); // knocked back, away from the bowler
      stump.rotation.z = settle * (struck ? 0.6 : 0.08) * lean; // and sideways, so it shows from behind
      stump.position.z = struck ? settle * 0.22 : 0;
      stump.position.y = struck ? Math.sin(Math.PI * w) * 0.14 : 0;
    });
    bails.forEach(({ mesh, x }, index) => {
      const side = index === 0 ? -1 : 1;
      const rise = height + BAIL_RADIUS + 2.6 * w - 3.5 * w * w; // up, then down to the turf
      mesh.position.set(x + side * 0.5 * w, Math.max(rise, BAIL_RADIUS), 0.35 * w);
      mesh.rotation.set(w * 9 * side, w * 4, Math.PI / 2 + w * 7);
    });
  }

  setBreak(0);
  return { group, setBreak };
}

// The one place where data axes become scene axes.
//
// Data (ADR-012): origin at the base of the batter's middle stump, +x off side
// of a right-hander, +y up the pitch towards the bowler, +z up. Right-handed.
// Three.js: +Y up, right-handed.
//
//   scene X =  data x   (off side)
//   scene Y =  data z   (up)
//   scene Z = -data y   (the bowler is at negative Z)
//
// The matrix has determinant +1, so it is a rotation and handedness is kept:
// seen from behind the batter's stumps looking up the pitch, +x is on the right.
import { Vector3 } from 'three';

export function toScene(x, y, z, target = new Vector3()) {
  return target.set(x, z, -y);
}

export const pointToScene = ([x, y, z]) => toScene(x, y, z);

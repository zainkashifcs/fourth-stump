// The bowler (assets/bowler.glb), frozen in the delivery stride with the
// bowling hand on the first point of the path, and a first slip
// (assets/slip.glb) crouched behind the batter's wicket.
import * as THREE from 'three';
import { toScene } from '../coords.js';
import { placeholderFigure } from './placeholder.js';

const SLIP = [1.6, -4.8]; // data x, y: first slip, just out of the default shot so it is never half in frame
const hand = new THREE.Vector3();

export function buildBowler(gltf) {
  const group = new THREE.Group(); // the model faces +Z: down the pitch at the batter
  const figure = gltf ? gltf.scene : placeholderFigure();
  group.add(figure);
  const release = figure.getObjectByName('release') ?? figure;
  let placed = '';

  // Stands the bowler so the bowling hand is exactly on `point` (data
  // coordinates, the first point of the path). The model is a right-armer; a
  // left-armer is its mirror image, which puts the body on the other side of
  // the stumps.
  function place(point, arm) {
    const key = `${arm}:${point.join(',')}`;
    if (key === placed) return;
    placed = key;
    const mirror = arm === 'left' ? -1 : 1;
    group.position.set(0, 0, 0);
    group.scale.set(mirror, 1, 1);
    group.updateMatrixWorld(true);
    const height = point[2] / Math.max(release.getWorldPosition(hand).y, 0.5); // a tall fast bowler: the hand reaches the release height
    group.scale.set(mirror * height, height, height);
    group.updateMatrixWorld(true);
    release.getWorldPosition(hand); // measured before the group moves: reading it refreshes the group's matrix
    group.position.copy(toScene(...point)).sub(hand);
    group.updateMatrixWorld(true);
  }

  return { group, place };
}

export function buildSlip(gltf) {
  const group = new THREE.Group();
  const figure = gltf ? gltf.scene : placeholderFigure();
  group.add(figure);
  group.position.copy(toScene(SLIP[0], SLIP[1], 0));
  group.rotation.y = Math.PI + 0.25; // facing up the pitch, angled in at the bat
  group.updateMatrixWorld(true);
  const catchPoint = (figure.getObjectByName('catch') ?? figure).getWorldPosition(new THREE.Vector3());
  return { group, catchPoint };
}

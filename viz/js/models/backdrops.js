// One backdrop per venue behind the bowler's end, so the three grounds read
// differently at a glance: the Lord's Pavilion (assets/lords.glb), the old
// WACA scoreboard (assets/perth.glb), and Table Mountain with Devil's Peak
// (assets/newlands.glb). The file name is the venue's key in the data file.
import { toScene } from '../coords.js';
import { placeholderBackdrop } from './placeholder.js';

const DISTANCE = 66; // metres behind the bowler's stumps

const SKIES = { lords: 0xb9cfe2, perth: 0x56b0ee, newlands: 0x8ec8f3 };
export const skyFor = (venue) => SKIES[venue] ?? 0x9fc9ea;

// models: { venueKey: gltf | null }. Returns { venueKey: Object3D }, all hidden.
export function buildBackdrops(models, pitchLength) {
  return Object.fromEntries(Object.entries(models).map(([key, gltf]) => {
    const backdrop = gltf ? gltf.scene : placeholderBackdrop();
    backdrop.position.add(toScene(0, pitchLength + DISTANCE, 0));
    backdrop.visible = false;
    return [key, backdrop];
  }));
}

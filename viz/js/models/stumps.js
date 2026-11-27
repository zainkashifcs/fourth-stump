// The wicket (assets/stumps.glb): three stumps and two bails, authored in the
// page's data axes with its origin at the base of middle stump. Its one clip,
// Stumps_Shatter, breaks the wicket and holds the last frame. If the model is
// missing, the procedural wicket stands in.
import { toScene } from '../coords.js';
import { createRig } from './rig.js';
import { buildWicket } from './wicket.js';

const SHATTER = 'Stumps_Shatter';

// y: where the wicket stands along the pitch, in data coordinates.
export function buildStumps(gltf, constants, y) {
  if (!gltf) {
    const wicket = buildWicket(constants, y);
    return { group: wicket.group, pose: (sinceHit) => wicket.setBreak(sinceHit == null ? 0 : sinceHit / 0.9), clips: [] };
  }
  const rig = createRig(gltf);
  rig.root.position.copy(toScene(0, y, 0));
  // sinceHit: seconds since the ball broke the wicket, or null while it stands
  const pose = (sinceHit) => rig.pose(sinceHit == null || sinceHit < 0 ? [] : [{ clip: SHATTER, time: sinceHit }]);
  return { group: rig.root, pose, clips: rig.played };
}

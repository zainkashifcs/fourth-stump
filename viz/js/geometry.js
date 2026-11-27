// Where the batter stands and where a delivery goes after the stumps. Pure
// functions in data coordinates (x off side, y up the pitch, z up), tested under node.

export const STANCE_X = -0.48; // the right-hander's stance root, outside leg stump
export const BODY_LIMIT = -0.15; // head, torso, legs and pads never come inside this line
const LEG_LIMIT = -0.9; // the furthest the batter moves towards leg to reach the line
export const KEEPER_Y = -1.4; // the wicketkeeper's catching plane, behind the stumps
// The ring fielder at cover, brought in to about 11 m: outside the
// behind-the-stumps frame, inside the side-on and from-above ones.
export const COVER = [10, 4];

// The batter's root across the crease (data x) for an action. ballX: the line
// the bat goes to. batLine: rig distance from the root to the middle of the bat
// face at contact. bodyEdge: the furthest off-side reach of head, torso, legs and pads;
// bodyBack: the same towards leg (the stance is symmetric). ballRadius: the clearance kept.
// A leave keeps the stance unless the ball's line would pass through the body;
// then the batter steps further to the leg side, just far enough for it to miss.
export function batterRootX(action, ballX, { batLine = 0.7, bodyEdge = 0.25, bodyBack = bodyEdge, ballRadius = 0 } = {}) {
  if (action === 'play') return Math.min(Math.max(ballX - batLine, LEG_LIMIT), BODY_LIMIT - bodyEdge);
  const hits = ballX + ballRadius > STANCE_X - bodyBack && ballX - ballRadius < STANCE_X + bodyEdge;
  return hits ? ballX - ballRadius - bodyEdge : STANCE_X;
}

// How far the batter's whole body may shift, as the bat is steered onto the ball in the last
// moments of a shot: across (data x) up to the body rule on the off side and STEER_LEG on the
// leg side (a little past LEG_LIMIT, to get inside a ball down the leg side), along the pitch at
// most ROOT_STEP. rootX: the root now; move: [across, along], metres.
export const ROOT_STEP = 0.12;
export const STEER_LEG = LEG_LIMIT - 0.3;
export function rootStep(rootX, [across, along], { bodyEdge = 0.25 } = {}) {
  const x = Math.min(Math.max(rootX + across, Math.min(STEER_LEG, rootX)), Math.max(BODY_LIMIT - bodyEdge, rootX)) - rootX;
  return [Math.abs(x) < 1e-15 ? 0 : x, Math.min(Math.max(along, -ROOT_STEP), ROOT_STEP)];
}

export const POPPING_CREASE = 1.22; // in front of each set of stumps (Laws of Cricket)

// Law 21.5 asks for some part of the front foot behind the popping crease; the bowler here is held
// to the stricter reading, the toe. toeY: the toe along the pitch (data y); stumpsY: the bowler's
// stumps. behind: metres the toe is short of the line (negative over it).
export function frontFoot(toeY, { stumpsY, crease = POPPING_CREASE }) {
  const behind = toeY - (stumpsY - crease);
  return { legal: behind >= -1e-9, behind };
}

// The bowler after the release: two decelerating strides on down the pitch, peeling off it
// away from the stumps (Law 41.8 keeps him off the protected area): to the off side for a
// right-armer over the wicket, his mirror for a left-armer. Metres to add to his root
// (data x, y) `since` seconds after the release.
export const FOLLOW = { seconds: 0.9, carry: 2.2, peel: 1.1 };
export function followThrough(since, arm = 'right', { seconds, carry, peel } = FOLLOW) {
  const q = Math.min(Math.max(since / seconds, 0), 1);
  const side = arm === 'left' ? -1 : 1;
  return [side * peel * q * q, -carry * (1 - (1 - q) * (1 - q))];
}

// The keeper's step across and rise for a ball reaching his plane: what his gloves at the take
// (`gloves`, crouched where he stands) need to meet the ball, as far as a short side step and
// straightening up allow; his arms reach for the rest. Scene axes: x across, y up.
export const KEEPER_STEP = 0.6;
export const KEEPER_RISE = [-0.15, 0.45];
export function keeperReach(ball, gloves) {
  return {
    step: Math.min(Math.max(ball[0] - gloves[0], -KEEPER_STEP), KEEPER_STEP),
    rise: Math.min(Math.max(ball[1] - gloves[1], KEEPER_RISE[0]), KEEPER_RISE[1]),
  };
}

const GRAVITY = 9.81;
const PACE_PAST_STUMPS = 30; // m/s along the pitch: a seam bowler's delivery after the bounce

// The path continued from its last segment, with gravity, to the keeper's plane.
// This stretch is extrapolated for the picture, not simulated by the engine.
export function extendToKeeper(path, { keeperY = KEEPER_Y, floor = 0, pace = PACE_PAST_STUMPS } = {}) {
  if (path.length < 2) return path;
  const [x0, y0, z0] = path[path.length - 2];
  const [x1, y1, z1] = path[path.length - 1];
  const step = y1 - y0; // negative: the ball travels towards -y
  if (!(step < 0) || y1 <= keeperY) return path;
  const count = Math.ceil((y1 - keeperY) / -step);
  const extra = Array.from({ length: count }, (_, i) => {
    const y = i === count - 1 ? keeperY : y1 + step * (i + 1);
    const along = (y - y1) / step; // in units of the last segment
    const drop = 0.5 * GRAVITY * ((y1 - y) / pace) ** 2;
    return [x1 + (x1 - x0) * along, y, Math.max(z1 + (z1 - z0) * along - drop, floor)];
  });
  return [...path, ...extra];
}

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

export const POPPING_CREASE = 1.22; // in front of each set of stumps (Laws of Cricket)

// Law 21.5 asks for some part of the front foot behind the popping crease; the bowler here is held
// to the stricter reading, the toe. toeY: the toe along the pitch (data y); stumpsY: the bowler's
// stumps. behind: metres the toe is short of the line (negative over it).
export function frontFoot(toeY, { stumpsY, crease = POPPING_CREASE }) {
  const behind = toeY - (stumpsY - crease);
  return { legal: behind >= -1e-9, behind };
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

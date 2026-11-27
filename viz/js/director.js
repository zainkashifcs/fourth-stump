// The broadcast director: which of three cameras is live during a delivery
// with a run-up, and where that camera is. Pure functions of time, in data
// coordinates (x off side, y up the pitch, z up), tested under node.

export const RELEASE = 1.35; // seconds from the start of the run-up to the ball leaving the hand
const CREASE_CUT = 0.8; // the bowler gathers for the delivery stride

const TAGS = { 1: 'CAM 1 // MARK', 2: 'CAM 2 // CREASE', 3: 'CAM 3 // BATTER EYE' };

// time: seconds from the start of the run-up. eventTime: when the ball meets
// the bat or the stumps on the same clock, once an outcome is known.
export function cutAt(time, { eventTime = Infinity } = {}) {
  const id = time < CREASE_CUT ? 1 : time < RELEASE ? 2 : 3;
  return { id, tag: TAGS[id], punchIn: id === 3 && time >= eventTime };
}

const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

// Where the live camera is. side: +1 for a right-armer, -1 for a left-armer
// (the side of the stumps the bowler runs in on). ball and impact are points;
// home is the page's behind-the-stumps camera { position, target }.
export function shotFor(cut, { time, side, pitchLength, ball, impact, home }) {
  if (cut.id === 1) {
    // low behind the bowler's mark, a little to the bowling-arm side, tracking in with the run
    const travelled = 4 * Math.min(time / CREASE_CUT, 1);
    return { position: [-side * 0.2, pitchLength + 11 - travelled, 0.9], target: [side * 0.2, 2, 1.1], fov: 32 };
  }
  if (cut.id === 2) {
    // tight and side-on at the crease, from the bowling-arm side
    return { position: [-side * 3.5, pitchLength - 1.5, 1.35], target: [side * 0.6, pitchLength - 1.3, 1.3], fov: 42 };
  }
  if (cut.punchIn && impact) {
    // close on the bat or the stumps, with the whole batter and the wicket still in shot
    return { position: [impact[0] * 0.4 + 0.3, impact[1] - 4.6, 1.8], target: [impact[0] * 0.5, impact[1], 0.62], fov: 30 };
  }
  // behind the stumps, leaning a little towards the ball
  return { position: home.position, target: ball ? mix(home.target, ball, 0.22) : home.target, fov: null };
}

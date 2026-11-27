// The broadcast director: the page's three camera presets, which of three
// cameras is live during a delivery with a run-up, and where that camera is.
// Pure functions of time, in data coordinates (x off side, y up the pitch,
// z up), tested under node.

export const RELEASE = 1.35; // seconds from the start of the run-up to the ball leaving the hand
const CREASE_CUT = 0.8; // the bowler gathers for the delivery stride

export const VERTICAL_FOV = 34;
const MIN_HORIZONTAL_FOV = 24; // narrow views widen their lens instead of cropping the pitch

// Camera positions and targets. Each frames the bowler at the release and the
// keeper's plane behind the stumps, with the bowler clear of the camera tag at
// the top and the batter clear of the captions along the bottom; the side-on preset widens its lens in a narrow view so the whole
// 22 yards stay across it. From above is the high broadcast camera in the stand
// behind the batter, a little to the off side: the whole pitch, the cover fielder,
// and the rope, boards and stands on the far side of the ground.
export const CAMERAS = {
  stumps: { label: 'Behind the stumps', position: [0.2, -6.6, 2.5], target: [0.15, 4, 0.7] },
  side: { label: 'Side on', position: [30, 9.6, 8], target: [0, 9.6, 0.8], minHorizontalFov: 44 },
  above: { label: 'From above', position: [6, -32, 24], target: [3, 12, 0], minHorizontalFov: 44 },
};

const radians = (deg) => (deg * Math.PI) / 180;
const degrees = (rad) => (rad * 180) / Math.PI;

// The vertical field of view for a view of this aspect (width over height).
export function fovFor(aspect, minHorizontal = MIN_HORIZONTAL_FOV) {
  const horizontal = 2 * Math.atan(Math.tan(radians(VERTICAL_FOV) / 2) * aspect);
  if (degrees(horizontal) >= minHorizontal) return VERTICAL_FOV;
  return degrees(2 * Math.atan(Math.tan(radians(minHorizontal) / 2) / aspect));
}

const TAGS = { 1: 'CAM 1 // MARK', 2: 'CAM 2 // CREASE' };
const LIVE_TAGS = { stumps: 'CAM 3 // STUMP CAM', side: 'CAM 3 // SIDE ON', above: 'CAM 3 // FROM ABOVE' };

// time: seconds from the start of the run-up. eventTime: when the ball meets
// the bat or the stumps on the same clock, once an outcome is known. camera:
// the preset the visitor has chosen, which cut 3 lands on. through: the ball
// passes the bat and the stumps untouched, so there is nothing to close in on.
export function cutAt(time, { eventTime = Infinity, camera = 'stumps', through = false } = {}) {
  const id = time < CREASE_CUT ? 1 : time < RELEASE ? 2 : 3;
  const preset = CAMERAS[camera] ? camera : 'stumps';
  return {
    id,
    tag: id === 3 ? LIVE_TAGS[preset] : TAGS[id],
    camera: preset,
    punchIn: id === 3 && preset === 'stumps' && !through && time >= eventTime, // the wider presets hold the whole pitch
  };
}

// Whether the keeper is drawn. Crouched 1.4 m behind the stumps he would stand between the
// behind-the-stumps camera and everything it is there to show (batter, wicket, the ball's path),
// so that camera, and its close-up, leave him out. The cut from behind the bowler's mark and the
// one side-on at the crease look back down the pitch and keep him, as do side on and from above.
// preset: the camera chosen; cut: the director's cut when a run-up is shown, else null.
export function showsKeeper(preset, cut = null) {
  if (cut && cut.id < 3) return true;
  return (cut?.camera ?? preset) !== 'stumps';
}

// The camera's jolt as the stumps are hit: 25 ms, about 1.5 cm, dying away. Metres to add to
// the camera's position (data axes), or null outside it. sinceHit: seconds since the stumps broke.
export const SHAKE = { seconds: 0.025, size: 0.015 };
export function shakeOffset(sinceHit) {
  if (typeof sinceHit !== 'number' || !(sinceHit >= 0) || sinceHit >= SHAKE.seconds) return null;
  const left = SHAKE.size * (1 - sinceHit / SHAKE.seconds);
  return [left * Math.sin(sinceHit * 1300), 0, left * Math.cos(sinceHit * 1700)];
}

const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

// Where the live camera is. side: +1 for a right-armer, -1 for a left-armer
// (the side of the stumps the bowler runs in on). ball and impact are points.
// fov: null means the chosen preset's own lens (fovFor).
export function shotFor(cut, { time, side, pitchLength, ball, impact }) {
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
    // close on the bat or the stumps, with the whole batter, head and raised bat included, and the wicket still in shot
    return { position: [impact[0] * 0.4 + 0.3, impact[1] - 4.6, 1.7], target: [impact[0] * 0.5, impact[1], 0.85], fov: VERTICAL_FOV };
  }
  // the chosen preset; behind the stumps it leans a little towards the ball
  const home = CAMERAS[cut.camera] ?? CAMERAS.stumps;
  const lean = cut.camera === 'stumps' && ball ? 0.22 : 0;
  return { position: home.position, target: lean ? mix(home.target, ball, lean) : home.target, fov: null };
}

// Where in a baked clip to pose a rig. Pure, tested under node.
//
// The Blender build checks every baked frame (both hands on the handle, the
// body off the line of the ball); between frames the mixer interpolates each
// bone on its own, which can pull the hands off the bat in a fast swing. So a
// clip is only shown on its baked frames, which also suits the stepped look.

// time: seconds into the clip; step: seconds between baked frames (0 if unknown).
export function clipTime(time, { duration, looping, step }) {
  const inside = looping ? ((time % duration) + duration) % duration : Math.min(Math.max(time, 0), duration);
  const snapped = step > 0 ? Math.round(inside / step) * step : inside;
  if (looping) return snapped >= duration - 1e-9 ? 0 : snapped; // the loop's last frame is its first
  return Math.min(snapped, duration - 1e-4); // inside the clip, so a held last frame is not "finished"
}

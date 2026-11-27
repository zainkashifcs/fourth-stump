// Which animation plays for an action and the outcome the data gives it.
// Pure data, tested under node.
//
//   batter   what the batter does: 'defend' (forward defensive) or 'leave' (shouldering arms)
//   ball     what the ball does after the bat or the stumps:
//              'dead'        drops off the bat into the off-side turf
//              'edge-short'  flies off the outside edge and dies short of slip
//              'edge-carry'  flies off the outside edge and carries to slip
//              'stumps'      breaks the wicket
//              'through'     passes untouched
//   bat      where the bat is, in metres from the line of the ball (negative is inside it)
//   flash    the broadcast caption for a dismissal, or null
//   clips    the batter's clips in order: the shot, then what follows it (models/batter.js)
//   then     when the second clip starts: 'end' of the first, or the 'event' (the stumps
//            breaking), never before the first clip has ended
//   contact  what the bat does at the ball (contact.js): 'face', 'edge', 'miss', 'gate', or null

const FD = 'Forward_Defensive';
const LEAVE = 'Leave_Shoulder_Arms';
const EDGE = 'Edge_Flash';

const ANIMATIONS = {
  'leave:safe': { name: 'left-alone', batter: 'leave', ball: 'through', bat: 0, flash: null, clips: [LEAVE], then: 'end', contact: null },
  'leave:bowled': {
    name: 'bowled', batter: 'leave', ball: 'stumps', bat: 0, flash: 'Bowled', clips: [LEAVE, 'Bowled_After_Leave'], then: 'event', contact: null,
  },
  'play:middled': { name: 'middled', batter: 'defend', ball: 'dead', bat: 0, flash: null, clips: [FD, 'Follow_Through'], then: 'end', contact: 'face' },
  'play:edged_safe': { name: 'edged-short', batter: 'defend', ball: 'edge-short', bat: -0.07, flash: null, clips: [EDGE], then: 'end', contact: 'edge' },
  'play:edged_caught': {
    name: 'edged-caught', batter: 'defend', ball: 'edge-carry', bat: -0.07, flash: 'Caught', clips: [EDGE, 'Head_Drop'], then: 'end', contact: 'edge',
  },
  'play:missed': { name: 'play-and-miss', batter: 'defend', ball: 'through', bat: -0.16, flash: null, clips: [FD], then: 'end', contact: 'miss' },
  'play:missed_bowled': {
    name: 'bowled', batter: 'defend', ball: 'stumps', bat: 0.17, flash: 'Bowled', clips: [FD, 'Bowled_After_Play'], then: 'event', contact: 'gate',
  },
};

const BATTER = { leave: 'leave', play: 'defend' };
const UNKNOWN_CLIPS = { leave: [LEAVE], play: [FD] };

// A clip that may be missing from batter.glb, and the one shown in its place.
export const CLIP_FALLBACKS = { Leave_Duck_Sway: LEAVE };

// An outcome the table does not know still gets the right batter action, with the ball passing through.
// length: 'good' | 'yorker' | 'bouncer'; a bouncer left alone is ducked or swayed out of the way.
export function animationFor(action, outcome, length = 'good') {
  const known = ANIMATIONS[`${action}:${outcome}`];
  if (known?.name === 'left-alone' && length === 'bouncer') return { ...known, clips: ['Leave_Duck_Sway'] };
  return known ?? {
    name: 'unknown', batter: BATTER[action] ?? 'stance', ball: 'through', bat: -0.16, flash: null,
    clips: UNKNOWN_CLIPS[action] ?? [], then: 'end', contact: action === 'play' ? 'miss' : null,
  };
}

export const WATCHING = { name: 'watching', batter: 'stance', ball: 'through', bat: 0, flash: null, clips: [], then: 'end', contact: null };

// The clips the batter actually plays for an animation, given which clips the model has
// (has(name) -> boolean): a missing shot falls back (CLIP_FALLBACKS), a missing follow-up
// leaves the shot holding its last pose, as before the follow-ups existed.
export function batterClips(animation, has) {
  const [shot, next] = animation.clips ?? [];
  const first = [shot, CLIP_FALLBACKS[shot]].find((name) => name && has(name)) ?? null;
  const then = first && next && has(next) ? next : null;
  return { first, then, thenAt: animation.then ?? 'end' };
}

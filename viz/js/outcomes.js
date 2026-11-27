// Which animation plays for an action and the outcome the data gives it.
// Pure data, tested under node.
//
//   batter  what the batter does: 'defend' (forward defensive) or 'leave' (shouldering arms)
//   ball    what the ball does after the bat or the stumps:
//             'dead'        drops off the bat into the off-side turf
//             'edge-short'  flies off the outside edge and dies short of slip
//             'edge-carry'  flies off the outside edge and carries to slip
//             'stumps'      breaks the wicket
//             'through'     passes untouched
//   bat     where the bat is, in metres from the line of the ball (negative is inside it)
//   flash   the broadcast caption for a dismissal, or null

const ANIMATIONS = {
  'leave:safe': { name: 'left-alone', batter: 'leave', ball: 'through', bat: 0, flash: null },
  'leave:bowled': { name: 'bowled', batter: 'leave', ball: 'stumps', bat: 0, flash: 'Bowled' },
  'play:middled': { name: 'middled', batter: 'defend', ball: 'dead', bat: 0, flash: null },
  'play:edged_safe': { name: 'edged-short', batter: 'defend', ball: 'edge-short', bat: -0.07, flash: null },
  'play:edged_caught': { name: 'edged-caught', batter: 'defend', ball: 'edge-carry', bat: -0.07, flash: 'Caught' },
  'play:missed': { name: 'play-and-miss', batter: 'defend', ball: 'through', bat: -0.16, flash: null },
  'play:missed_bowled': { name: 'bowled', batter: 'defend', ball: 'stumps', bat: 0.17, flash: 'Bowled' },
};

const BATTER = { leave: 'leave', play: 'defend' };

// An outcome the table does not know still gets the right batter action, with the ball passing through.
export function animationFor(action, outcome) {
  return ANIMATIONS[`${action}:${outcome}`]
    ?? { name: 'unknown', batter: BATTER[action] ?? 'stance', ball: 'through', bat: -0.16, flash: null };
}

export const WATCHING = { name: 'watching', batter: 'stance', ball: 'through', bat: 0, flash: null };

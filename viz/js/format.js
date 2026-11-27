// Plain-text formatting. No DOM, so it can be tested under node.

const MINUS = '−';

// One decimal from 1% up; below that, enough decimals that a small non-zero
// probability never reads as zero.
export function percent(p) {
  const value = p * 100;
  if (value === 0 || value >= 0.95) return `${value.toFixed(1)}%`;
  const digits = [2, 3].find((d) => Number(value.toFixed(d)) > 0);
  return digits ? `${value.toFixed(digits)}%` : '<0.001%';
}

export function signedRuns(value) {
  const text = Math.abs(value).toFixed(2);
  if (Number(text) === 0) return '0.00';
  return `${value < 0 ? MINUS : '+'}${text}`;
}

export function runs(value) {
  return `${value.toFixed(1)} runs`;
}

export function overs(age) {
  return `${age} ${age === 1 ? 'over' : 'overs'}`;
}

const ARMS = { right: 'Right-arm over', left: 'Left-arm over' };
export const armLabel = (arm) => ARMS[arm] ?? arm;

const ACTIONS = { leave: 'Leave', play: 'Play' };
export const actionLabel = (action) => ACTIONS[action] ?? action;

const OUTCOMES = {
  safe: 'Left alone safely',
  bowled: 'Bowled',
  middled: 'Middled',
  edged_safe: 'Edged, fell short',
  edged_caught: 'Edged and caught',
  missed: 'Play-and-miss',
  missed_bowled: 'Play-and-miss, bowled',
};
export const outcomeLabel = (outcome) => OUTCOMES[outcome] ?? outcome;

const cm = (metres) => `${Math.round(Math.abs(metres) * 100)} cm`;

// Where a delivery passes the plane of the batter's stumps, in words.
export function lineAtStumps(x, stumpHalfWidth) {
  const outside = Math.abs(x) - stumpHalfWidth;
  if (Math.round(outside * 100) <= 0) return 'in line with the stumps'; // never "0 cm outside"
  return `${cm(outside)} outside ${x > 0 ? 'off' : 'leg'} stump`;
}

export function heightAtStumps(z, stumpHeight) {
  const gap = z - stumpHeight;
  if (Math.round(Math.abs(gap) * 100) === 0) return 'level with the bails'; // never "0 cm above"
  return gap > 0 ? `${cm(gap)} above the bails` : `${cm(gap)} below the bails`;
}

// Rules of "Test Your Eye". Pure functions, no DOM, tested under node.

export const ROUND_LENGTH = 6; // one over

const DISMISSALS = new Set(['bowled', 'edged_caught', 'missed_bowled']);

export function pickRound(deliveries, length = ROUND_LENGTH, random = Math.random) {
  const pool = [...deliveries];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, length);
}

export const evOf = (delivery, action) => (action === 'leave' ? delivery.ev_leave : delivery.ev_play);

export const outcomeOf = (delivery, action) =>
  action === 'leave' ? delivery.outcome_leave : delivery.outcome_play;

export const otherAction = (action) => (action === 'leave' ? 'play' : 'leave');

export const isDismissal = (outcome) => DISMISSALS.has(outcome);

// The index of the last point the visitor sees before choosing.
// shortcut: a delivery that never bounces (bounce_index -1) is cut at 60% of
// its path; upgrade if the export starts to carry the commit point.
export function cutIndex(delivery) {
  const last = delivery.path.length - 1;
  return delivery.bounce_index >= 0 ? Math.min(delivery.bounce_index, last) : Math.floor(last * 0.6);
}

export const emptyScore = () => ({ choices: [], ev: 0, bestEv: 0, correct: 0, dismissals: 0 });

export function addChoice(score, delivery, action) {
  const outcome = outcomeOf(delivery, action);
  const correct = action === delivery.best;
  return {
    choices: [...score.choices, { id: delivery.id, action, outcome, correct }],
    ev: score.ev + evOf(delivery, action),
    bestEv: score.bestEv + evOf(delivery, delivery.best),
    correct: score.correct + (correct ? 1 : 0),
    dismissals: score.dismissals + (isDismissal(outcome) ? 1 : 0),
  };
}

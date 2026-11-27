// Run with: node --test viz/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percent, signedRuns, lineAtStumps, heightAtStumps, outcomeLabel } from '../js/format.js';
import { addChoice, cutIndex, emptyScore, pickRound } from '../js/game-logic.js';
import { validate, findScenario, venueKeys } from '../js/data.js';
import { animationFor } from '../js/outcomes.js';

test('formats probabilities and expected values', () => {
  assert.equal(percent(0.05357), '5.4%');
  assert.equal(percent(0), '0.0%');
  assert.equal(percent(1), '100.0%');
  assert.equal(percent(0.0027), '0.27%');
  assert.equal(percent(0.00019), '0.02%');
  assert.equal(percent(0.00002), '0.002%');
  assert.equal(percent(0.000001), '<0.001%');
  assert.equal(percent(0.0096), '1.0%');
  assert.equal(signedRuns(-17.1752), '−17.18');
  assert.equal(signedRuns(-1.6072), '−1.61');
  assert.equal(signedRuns(0.5), '+0.50');
  assert.equal(signedRuns(-0), '0.00');
  assert.equal(signedRuns(-0.001), '0.00');
  assert.equal(lineAtStumps(0.3953, 0.1143), '28 cm outside off stump');
  assert.equal(lineAtStumps(-0.3, 0.1143), '19 cm outside leg stump');
  assert.equal(lineAtStumps(0.05, 0.1143), 'in line with the stumps');
  assert.equal(lineAtStumps(0.117, 0.1143), 'in line with the stumps');
  assert.equal(lineAtStumps(-0.117, 0.1143), 'in line with the stumps');
  assert.equal(heightAtStumps(0.6245, 0.711), '9 cm below the bails');
  assert.equal(outcomeLabel('edged_caught'), 'Edged and caught');
  assert.equal(outcomeLabel('something_new'), 'something_new');
});

test('scores a round without mutating the previous score', () => {
  const delivery = {
    id: 7, path: [[0, 2, 1], [0, 1, 0], [0, 0, 1]], bounce_index: 1,
    outcome_leave: 'bowled', outcome_play: 'middled', ev_leave: -8, ev_play: 0.5, best: 'play',
  };
  const start = emptyScore();
  const afterLeave = addChoice(start, delivery, 'leave');
  assert.deepEqual(start, emptyScore());
  assert.deepEqual(
    { ev: afterLeave.ev, bestEv: afterLeave.bestEv, correct: afterLeave.correct, dismissals: afterLeave.dismissals },
    { ev: -8, bestEv: 0.5, correct: 0, dismissals: 1 },
  );
  const afterPlay = addChoice(afterLeave, delivery, 'play');
  assert.equal(afterPlay.ev, -7.5);
  assert.equal(afterPlay.correct, 1);
  assert.equal(afterPlay.choices.length, 2);
});

test('cuts at the bounce, or part-way when there is no bounce', () => {
  const path = Array.from({ length: 11 }, (_, i) => [0, 10 - i, 1]);
  assert.equal(cutIndex({ path, bounce_index: 4 }), 4);
  assert.equal(cutIndex({ path, bounce_index: -1 }), 6);
});

test('picks a round of distinct deliveries', () => {
  const pool = Array.from({ length: 20 }, (_, id) => ({ id }));
  const round = pickRound(pool, 6);
  assert.equal(new Set(round.map((d) => d.id)).size, 6);
  assert.equal(pickRound(pool.slice(0, 3), 6).length, 3);
  assert.equal(pool[0].id, 0);
});

test('the exported file passes validation and has every scenario', () => {
  const data = validate(JSON.parse(readFileSync(new URL('../data/trajectories.json', import.meta.url))));
  for (const venue of venueKeys(data)) {
    for (const ballAge of data.ball_ages) {
      for (const arm of data.arms) {
        assert.ok(findScenario(data, { venue, ballAge, arm, end: 0 }), `${venue} ${ballAge} ${arm}`);
      }
    }
  }
  assert.throws(() => validate({ meta: {} }), /meta\.constants/);
});

test('maps every action and outcome to its animation', () => {
  const pick = (action, outcome) => {
    const { batter, ball, flash } = animationFor(action, outcome);
    return [batter, ball, flash];
  };
  assert.deepEqual(pick('leave', 'safe'), ['leave', 'through', null]);
  assert.deepEqual(pick('leave', 'bowled'), ['leave', 'stumps', 'Bowled']);
  assert.deepEqual(pick('play', 'middled'), ['defend', 'dead', null]);
  assert.deepEqual(pick('play', 'edged_safe'), ['defend', 'edge-short', null]);
  assert.deepEqual(pick('play', 'edged_caught'), ['defend', 'edge-carry', 'Caught']);
  assert.deepEqual(pick('play', 'missed'), ['defend', 'through', null]);
  assert.deepEqual(pick('play', 'missed_bowled'), ['defend', 'stumps', 'Bowled']);
  // an outcome the page does not know still has the batter take the action
  assert.deepEqual(pick('play', 'something_new'), ['defend', 'through', null]);
  assert.deepEqual(pick('leave', undefined), ['leave', 'through', null]);
});

test('every outcome in the exported file has an animation', () => {
  const data = JSON.parse(readFileSync(new URL('../data/trajectories.json', import.meta.url)));
  const seen = new Set();
  data.game.forEach((d) => seen.add(`leave:${d.outcome_leave}`).add(`play:${d.outcome_play}`));
  data.scenarios.forEach((s) => (s.fan_outcomes ?? []).forEach((o) => seen.add(`leave:${o.leave}`).add(`play:${o.play}`)));
  seen.forEach((key) => {
    const [action, outcome] = key.split(':');
    assert.notEqual(animationFor(action, outcome).name, 'unknown', key);
  });
});

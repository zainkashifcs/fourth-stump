// "Test Your Eye": watch a delivery as far as the bounce, choose leave or
// play, then see the true path, the outcome and the expected values.
import { h } from './dom.js';
import { venueKeys } from './data.js';
import {
  actionLabel, armLabel, heightAtStumps, lineAtStumps, outcomeLabel, overs, signedRuns,
} from './format.js';
import {
  addChoice, cutIndex, emptyScore, isDismissal, otherAction, outcomeOf, pickRound, ROUND_LENGTH,
} from './game-logic.js';
import { actionTable, venueColor, wicketCost } from './numbers.js';

const SPEED = 30; // path points per second, release to bounce
const REVEAL_SPEED = 16; // slower, so the movement off the pitch can be read

const PAST = { leave: 'left it', play: 'played' };

export function createGame(data, stage) {
  const { constants } = data.meta;
  const keys = venueKeys(data);
  let active = false;
  let round = [];
  let position = 0;
  let score = emptyScore();
  let phase = 'choose'; // 'choose' | 'revealed' | 'summary'

  const viewport = h('div', { class: 'viewport game-viewport', role: 'img' });
  const host = h('div', { class: 'game-stage' }, viewport);
  const panel = h('div', { class: 'game-panel' });
  const live = h('div', { class: 'game-live', 'aria-live': 'polite' }); // kept across renders so changes are announced
  const el = h('section', { class: 'game', 'aria-label': 'Test your eye' }, host, panel);

  const delivery = () => round[position];
  const colorOf = (d) => venueColor(Math.max(keys.indexOf(d.venue), 0));
  const venueOf = (d) => data.venues[d.venue] ?? { name: d.venue, ball: '', ends: [] };

  function show(animate) {
    const d = delivery();
    if (!active || !d || phase === 'summary') return;
    const last = stage.setDelivery(0, { path: d.path, bounceIndex: d.bounce_index, color: colorOf(d) });
    const cut = cutIndex(d);
    if (phase === 'revealed') stage.jump(0, last);
    else if (animate) stage.play(0, cut, SPEED);
    else stage.jump(0, cut);
  }

  function choose(action) {
    if (!active || phase !== 'choose' || !delivery()) return;
    score = addChoice(score, delivery(), action);
    phase = 'revealed';
    stage.play(0, delivery().path.length - 1, REVEAL_SPEED);
    render('next');
  }

  function next() {
    if (!active || phase !== 'revealed') return;
    if (position + 1 >= round.length) {
      phase = 'summary';
      render('again');
      return;
    }
    position += 1;
    phase = 'choose';
    show(true);
    render('leave');
  }

  function newRound(focus) {
    round = pickRound(data.game, ROUND_LENGTH);
    position = 0;
    score = emptyScore();
    phase = 'choose';
    show(true);
    render(focus);
  }

  // Panel ------------------------------------------------------------------
  function conditions(d) {
    const venue = venueOf(d);
    return h(
      'div',
      { class: 'game-case', style: `--venue:${colorOf(d)}` },
      h('p', { class: 'game-count', text: `Delivery ${position + 1} of ${round.length}` }),
      h('h2', {}, h('span', { class: 'swatch' }), venue.name),
      h('dl', { class: 'conditions' },
        h('div', {}, h('dt', { text: 'Ball age' }), h('dd', { text: overs(d.ball_age) })),
        h('div', {}, h('dt', { text: 'Bowler' }), h('dd', { text: armLabel(d.arm) })),
        h('div', {}, h('dt', { text: 'Bowling end' }), h('dd', { text: venue.ends[d.end] ?? `End ${d.end + 1}` })),
        h('div', {}, h('dt', { text: 'Ball' }), h('dd', { text: venue.ball }))),
    );
  }

  function choiceButtons(d) {
    const prompt = d.bounce_index >= 0
      ? 'The ball has bounced. Leave it or play it?'
      : 'This one is a full toss, stopped in flight. Leave it or play it?';
    const button = (action, key) => h(
      'button',
      { type: 'button', class: `button action action-${action}`, 'data-focus': action, 'aria-keyshortcuts': key, onclick: () => choose(action) },
      actionLabel(action), h('kbd', { text: key }),
    );
    return h('div', { class: 'choice' }, h('p', { class: 'prompt', text: prompt }), h('div', { class: 'choice-buttons' }, button('leave', 'L'), button('play', 'P')));
  }

  function reveal(d) {
    const { action, outcome, correct } = score.choices[score.choices.length - 1];
    const other = otherAction(action);
    const [x, , z] = d.path[d.path.length - 1];
    const lastDelivery = position + 1 >= round.length;
    return h(
      'div',
      { class: 'reveal' },
      h('p', { class: `outcome ${isDismissal(outcome) ? 'is-dismissal' : ''}`, text: outcomeLabel(outcome) }),
      h('p', { class: 'verdict' },
        `You ${PAST[action]}. `,
        correct ? `${actionLabel(action)} was the better action.` : `${actionLabel(d.best)} was the better action.`),
      actionTable(d, { chosen: action }),
      h('p', { class: 'fine' },
        `At the stumps it was ${lineAtStumps(x, constants.stump_half_width)}, ${heightAtStumps(z, constants.stump_height)}. `,
        `Had you ${PAST[other]}: ${outcomeLabel(outcomeOf(d, other)).toLowerCase()}.`),
      wicketCost(d, data.meta),
      h('button', { type: 'button', class: 'button button-primary', 'data-focus': 'next', 'aria-keyshortcuts': 'N', onclick: next },
        lastDelivery ? 'See the summary' : 'Next delivery', h('kbd', { text: 'N' })),
    );
  }

  function scoreline() {
    const cells = round.map((d, index) => {
      const choice = score.choices[index];
      if (!choice) return h('li', { class: index === position ? 'is-current' : '', 'aria-label': `Delivery ${index + 1}: not yet bowled` });
      const mark = isDismissal(choice.outcome) ? 'W' : actionLabel(choice.action).charAt(0);
      return h('li', {
        class: choice.correct ? 'is-correct' : 'is-wrong',
        'aria-label': `Delivery ${index + 1}: ${PAST[choice.action]}, ${outcomeLabel(choice.outcome).toLowerCase()}, ${choice.correct ? 'the better action' : 'not the better action'}`,
        text: mark,
      });
    });
    const done = score.choices.length;
    return h(
      'div',
      { class: 'scoreline' },
      h('ol', { class: 'over' }, cells),
      h('p', {}, done === 0
        ? 'One over of six deliveries. Your choices are scored by expected value.'
        : `Better action chosen ${score.correct} of ${done}. Your expected value ${signedRuns(score.ev)} runs, best possible ${signedRuns(score.bestEv)}.`),
    );
  }

  function summary() {
    const rows = round.map((d, index) => {
      const choice = score.choices[index];
      return h('tr', { class: choice.correct ? '' : 'is-wrong' },
        h('td', { text: index + 1 }),
        h('td', { text: venueOf(d).name }),
        h('td', { text: actionLabel(choice.action) }),
        h('td', { text: outcomeLabel(choice.outcome) }),
        h('td', { text: actionLabel(d.best) }));
    });
    const dismissed = ['were not dismissed', 'were dismissed once'][score.dismissals] ?? `were dismissed ${score.dismissals} times`;
    return h(
      'div',
      { class: 'summary' },
      h('h2', { text: 'Over complete' }),
      h('p', { class: 'verdict', text: `You chose the better action for ${score.correct} of ${round.length} deliveries and ${dismissed}.` }),
      h('dl', { class: 'totals' },
        h('div', {}, h('dt', { text: 'Your expected value' }), h('dd', { class: 'figure', text: signedRuns(score.ev) })),
        h('div', {}, h('dt', { text: 'Always the better action' }), h('dd', { class: 'figure', text: signedRuns(score.bestEv) })),
        h('div', {}, h('dt', { text: 'Given up' }), h('dd', { class: 'figure', text: signedRuns(score.ev - score.bestEv) }))),
      h('table', { class: 'summary-table' },
        h('thead', {}, h('tr', {}, ['', 'Ground', 'You', 'Outcome', 'Better'].map((text) => h('th', { scope: 'col', text })))),
        h('tbody', {}, rows)),
      h('button', { type: 'button', class: 'button button-primary', 'data-focus': 'again', onclick: () => newRound('leave') }, 'Bowl another over'),
    );
  }

  function render(focus) {
    const d = delivery();
    if (!d) {
      panel.replaceChildren(h('p', { class: 'empty', text: 'The data file has no game deliveries.' }));
      return;
    }
    viewport.setAttribute('aria-label', phase === 'choose'
      ? 'The delivery seen from behind the stumps. Its path after the bounce is hidden until you choose.'
      : 'The delivery seen from behind the stumps, with its full path to the wicket.');
    live.replaceChildren(phase === 'choose' ? choiceButtons(d) : reveal(d));
    panel.replaceChildren(...(phase === 'summary' ? [summary()] : [conditions(d), live, scoreline()]));
    if (focus) panel.querySelector(`[data-focus="${focus}"]`)?.focus();
  }

  document.addEventListener('keydown', (event) => {
    if (!active || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'l') choose('leave');
    else if (key === 'p') choose('play');
    else if (key === 'n') next();
  });

  return {
    el,
    activate() {
      active = true;
      stage.mount(host, [viewport]);
      stage.setCamera('stumps');
      if (round.length === 0) newRound();
      else show(false);
    },
    deactivate() {
      active = false;
    },
  };
}

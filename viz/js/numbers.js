// The numbers shown for a scenario or a game delivery: both share the same
// keys in the data file (p_*, ev_*, wicket_cost, best).
import { h } from './dom.js';
import { actionLabel, percent, runs, signedRuns } from './format.js';

// Colours identify venues everywhere on the page; they are assigned by the
// order of `venues` in the file, not by name.
const VENUE_COLORS = ['#e8b23a', '#58b8ec', '#bfa0f5', '#7fd6a8', '#f08fb3'];
export const venueColor = (index) => VENUE_COLORS[index % VENUE_COLORS.length];

const ACTIONS = ['leave', 'play'];

export function actionTable(d, { chosen } = {}) {
  const column = (action) => (action === d.best ? 'is-best' : '');
  const head = (action) => h(
    'th',
    { scope: 'col', class: column(action) },
    actionLabel(action),
    action === d.best && h('span', { class: 'tag tag-best', text: 'Better' }),
    action === chosen && h('span', { class: 'tag', text: 'Your choice' }),
  );
  const ev = { leave: d.ev_leave, play: d.ev_play };
  const dismissal = { leave: d.p_wicket_leave, play: d.p_wicket_play };
  return h(
    'table',
    { class: 'action-table' },
    h('thead', {}, h('tr', {}, h('td'), ACTIONS.map(head))),
    h(
      'tbody',
      {},
      h('tr', {},
        h('th', { scope: 'row' }, 'Expected value', h('span', { class: 'unit', text: ' runs' })),
        ACTIONS.map((a) => h('td', { class: `figure ${column(a)}`, text: signedRuns(ev[a]) }))),
      h('tr', {},
        h('th', { scope: 'row', text: 'Dismissal' }),
        ACTIONS.map((a) => h('td', { class: column(a), text: percent(dismissal[a]) }))),
    ),
  );
}

export function splitBar(d) {
  const parts = [
    { key: 'middled', label: 'Middled', p: d.p_middled },
    { key: 'edged', label: 'Edged', p: d.p_edged },
    { key: 'missed', label: 'Play-and-miss', p: d.p_missed },
  ];
  const summary = parts.map(({ label, p }) => `${label} ${percent(p)}`).join(', ');
  return h(
    'div',
    { class: 'split' },
    h('p', { class: 'split-title', text: 'When played' }),
    h('div', { class: 'split-bar', role: 'img', 'aria-label': `When played: ${summary}` },
      parts.map(({ key, p }) => h('span', { class: `split-${key}`, style: `flex-grow:${Math.max(p, 0.004)}` }))),
    h('ul', { class: 'split-legend', 'aria-hidden': 'true' },
      parts.map(({ key, label, p }) => h('li', { class: `split-${key}` }, label, ' ', h('b', { text: percent(p) })))),
  );
}

export function wicketCost(d, meta) {
  return h(
    'p',
    { class: 'cost' },
    `Wicket cost ${runs(d.wicket_cost)}`,
    meta.wicket_cost_source === 'placeholder' && h('span', { class: 'tag tag-warn', text: 'Placeholder' }),
  );
}

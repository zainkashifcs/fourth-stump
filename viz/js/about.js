// "How it works": a native dialog explaining the problem, the model and the
// stumps plot. Esc and the close button dismiss it, and the browser returns
// focus to the button that opened it.
import { h } from './dom.js';

export function createAbout(meta) {
  const draws = Number(meta.deliveries_per_estimate).toLocaleString('en-GB');
  const close = h('button', { type: 'button', class: 'button', text: 'Close' });
  const dialog = h(
    'dialog',
    { class: 'about', 'aria-labelledby': 'about-title' },
    h('header', {}, h('h2', { id: 'about-title', text: 'How it works' }), close),
    h('section', {},
      h('h3', { text: 'The fourth-stump problem' }),
      h('p', { text: 'A delivery in the corridor just outside off stump leaves a batter unsure whether it has to be played. The same release needs opposite answers at different grounds.' }),
      h('ul', {},
        h('li', {}, h('b', { text: "Lord's: " }), 'the 2.5 m slope across the ground moves the ball sideways at the bounce.'),
        h('li', {}, h('b', { text: 'The WACA, Perth: ' }), 'steep bounce carries many deliveries over the stumps. Its numbers pool 13 Tests at the WACA with 6 at Perth Stadium.'),
        h('li', {}, h('b', { text: 'Newlands: ' }), 'sharp seam deviation makes the ball harder to middle.'))),
    h('section', {},
      h('h3', { text: 'The model' }),
      h('p', { class: 'about-formula', text: 'EV = E[runs] − λ · P(dismissal)' }),
      h('p', { text: `Each state is estimated from ${draws} simulated deliveries by a C++20 structure-of-arrays Monte Carlo engine. Leave and play are scored on the same deliveries (common random numbers), so the noise they share cancels.` }),
      h('p', { text: 'The batter commits the bat one reaction time (0.2 s) before the ball arrives. λ is the wicket cost, read from a 10 × 80 run-expectancy table (wickets lost × ball age).' }),
      meta.wicket_cost_source === 'placeholder'
        && h('p', { class: 'note-warn', text: 'In this data file the wicket cost is a placeholder, not yet read from the run-expectancy table. The expected values will move when it is.' })),
    h('section', {},
      h('h3', { text: 'Reading the stumps plot' }),
      h('ul', { class: 'about-key' },
        h('li', {}, h('span', { class: 'key key-mean' }), 'Solid dot: the mean delivery.'),
        h('li', {}, h('span', { class: 'key key-sample' }), 'Hollow rings: sampled deliveries.'),
        h('li', {}, h('span', { class: 'key key-live' }), 'White ring: the delivery being bowled.'),
        h('li', {}, h('span', { class: 'key key-corridor' }), 'Grey band: the fourth-stump corridor.')),
      h('p', { text: 'The plot is seen from behind the stumps and draws the ball at its true size. In the 3D views the ball is drawn larger than life, and what it does after contact is illustration: the outcomes and numbers come from the data.' })),
  );
  const button = h('button', { type: 'button', class: 'button', text: '[ ? HOW IT WORKS ]', 'aria-haspopup': 'dialog' });
  button.addEventListener('click', () => dialog.showModal());
  close.addEventListener('click', () => dialog.close());
  return { button, dialog };
}

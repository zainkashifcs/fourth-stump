// Boot: load the data, build the stage and the two views, switch between them.
import { h, segmented } from './dom.js';
import { loadData } from './data.js';
import { createStage } from './stage.js';
import { createCompare } from './compare.js';
import { createGame } from './game.js';

const main = document.querySelector('#app');
const modeSlot = document.querySelector('#mode');

function showError(error) {
  main.replaceChildren(h(
    'div',
    { class: 'load-error', role: 'alert' },
    h('h2', { text: 'The trajectory data did not load' }),
    h('p', { text: 'This page reads data/trajectories.json and draws nothing without it.' }),
    h('p', {}, 'Serve this folder over HTTP, for example ', h('code', { text: 'python -m http.server' }),
      ', and write the file with ', h('code', { text: 'make viz-data' }), ' if it is missing.'),
    h('p', { class: 'fine', text: `Reason: ${error.message}` }),
  ));
}

async function start() {
  const data = await loadData();
  const stage = createStage(data.meta.constants);
  const modes = { compare: createCompare(data, stage), game: createGame(data, stage) };
  let current = null;

  function setMode(name) {
    if (current) {
      modes[current].deactivate();
      modes[current].el.hidden = true;
    }
    current = name;
    modes[name].el.hidden = false;
    modes[name].activate();
  }

  Object.values(modes).forEach((mode) => { mode.el.hidden = true; });
  main.replaceChildren(modes.compare.el, modes.game.el);
  modeSlot.replaceChildren(segmented({
    legend: 'View',
    hideLegend: true,
    className: 'mode-switch',
    options: [{ value: 'compare', label: 'Compare venues' }, { value: 'game', label: 'Test your eye' }],
    value: 'compare',
    onChange: setMode,
  }).el);
  setMode('compare');
}

start().catch(showError);

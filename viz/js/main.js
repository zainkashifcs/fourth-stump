// Boot: load the data and the models, build the stage and the two views,
// switch between them. The boot overlay follows the same promises.
import { h, segmented } from './dom.js';
import { fetchData, validate, venueKeys } from './data.js';
import { loadModels } from './models/load.js';
import { createStage } from './stage.js';
import { createCompare } from './compare.js';
import { createGame } from './game.js';
import { createBoot } from './boot.js';
import { createAudio } from './audio.js';
import { createAbout } from './about.js';

const main = document.querySelector('#app');
const tools = document.querySelector('#tools');
const colophon = document.querySelector('#colophon');
const FIGURES = ['batter', 'bowler', 'slip', 'fielder', 'stumps'];

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

const count = (value) => Number(value).toLocaleString('en-GB');
const upperName = (venue) => venue.name.toUpperCase();

// The loading steps, each a real promise; the boot screen shows them as they settle.
const audio = createAudio();
const fetched = fetchData();
const validated = fetched.then(validate);
const costed = validated.then((data) => {
  if (!data.scenarios.every((s) => Number.isFinite(s.wicket_cost))) throw new Error('a scenario has no wicket cost');
  return data;
});
const modelled = validated.then((data) => loadModels(FIGURES, [...venueKeys(data), 'stadium']));
const rigged = modelled.then((models) => {
  const missing = Object.keys(models).filter((name) => !models[name]);
  if (missing.length > 0) throw new Error(`placeholders drawn for ${missing.join(', ')}`);
});

const boot = createBoot({
  title: 'FOURTH STUMP // QUANT BROADCAST ENGINE v1.0',
  onReady: () => audio.play('chime'), // silent until a gesture has unlocked audio, so only a replay chimes
  steps: [
    { promise: fetched, label: (data) => `C++20 SOA MONTE CARLO DATA ... ${data ? `${count(data.meta?.deliveries_per_estimate)} DRAWS/STATE` : ''}` },
    { promise: costed, label: (data) => `MARKOV DP TABLE (10x80) ..... ${data ? 'LOADED' : ''}` },
    { promise: rigged, label: () => 'PS1-STYLE / BLENDER GLB RIGS ... NEAREST-FILTER LOCKED' },
    { promise: validated, label: (data) => `VENUES: ${data ? Object.values(data.venues).map(upperName).join(' / ') : ''}` },
  ],
});
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!new URLSearchParams(window.location.search).has('noboot') && !reducedMotion) boot.show();

async function start() {
  const data = await validated;
  const keys = venueKeys(data);
  const { meta } = data;
  const about = createAbout(meta);
  const stage = createStage(meta.constants, keys, await modelled, { onSound: audio.play });
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
  tools.replaceChildren(
    segmented({
      legend: 'View',
      hideLegend: true,
      className: 'mode-switch',
      options: [{ value: 'compare', label: 'Compare venues' }, { value: 'game', label: 'Test your eye' }],
      value: 'compare',
      onChange: setMode,
    }).el,
    about.button,
    audio.button,
  );
  document.body.append(about.dialog);
  colophon.replaceChildren(
    h('p', { class: 'fine', text: `${count(meta.deliveries_per_estimate)} deliveries per estimate, ${meta.wickets_lost} wickets lost, ${Number(meta.runs_middled).toFixed(2)} runs when middled, data generated ${meta.generated}.` }),
    h('button', { type: 'button', class: 'link', text: 'Replay boot', hidden: reducedMotion, onclick: () => boot.replay() }),
  );
  setMode('compare');
  // For checking by hand: fourthStump.preview('play', 'edged_caught') in the console; sounds lists what was
  // played; report() gives the clips the mixers have shown and how the textures are filtered.
  window.fourthStump = { preview: modes.compare.preview, sounds: audio.history, report: stage.report };
}

start().catch(showError);

// Comparison view: the same release at every venue, side by side, for the
// selected ball age, bowler arm and bowling end. "Bowl again" animates one
// sampled delivery per venue, with the batter taking that venue's better action.
import { h, segmented, toggle } from './dom.js';
import { endCount, findScenario, venueKeys } from './data.js';
import { actionLabel, armLabel, heightAtStumps, lineAtStumps, outcomeLabel, overs } from './format.js';
import { actionTable, splitBar, venueColor, wicketCost } from './numbers.js';
import { renderEndOn } from './endon.js';
import { cameraOptions } from './stage.js';
import { animationFor } from './outcomes.js';
import { createCaption } from './caption.js';

const lastPoint = (path) => {
  const [x, , z] = path[path.length - 1];
  return [x, z];
};

// One of the scenario's sampled deliveries, or its mean path if the file has no fan.
function sample(scenario, pick) {
  const fan = scenario.fan ?? [];
  if (fan.length === 0) return { path: scenario.path, bounceIndex: scenario.bounce_index, others: [] };
  const index = pick % fan.length;
  return {
    path: fan[index],
    bounceIndex: scenario.fan_bounce_index?.[index] ?? -1,
    outcomes: scenario.fan_outcomes?.[index],
    others: fan.filter((_, i) => i !== index),
    picked: lastPoint(fan[index]),
  };
}

export function createCompare(data, stage) {
  const { constants } = data.meta;
  const keys = venueKeys(data);
  const ends = Array.from({ length: endCount(data) }, (_, index) => index);
  let state = { ageIndex: 0, arm: data.arms[0], end: 0 };
  let runUp = false; // show the bowler's approach, under the three-camera director
  let cameraName = cameraOptions[0].value;
  let active = false;
  let bowled = 0;

  const setState = (patch) => {
    state = { ...state, ...patch };
    update();
  };

  // Controls -----------------------------------------------------------
  const ageOutput = h('output', { for: 'ball-age', class: 'age-value' });
  const ageInput = h('input', {
    type: 'range', id: 'ball-age', min: 0, max: data.ball_ages.length - 1, step: 1, value: 0,
    oninput: (event) => setState({ ageIndex: Number(event.target.value) }),
  });
  const ageField = h(
    'div',
    { class: 'field age-field' },
    h('div', { class: 'age-head' }, h('label', { for: 'ball-age', text: 'Ball age' }), ageOutput),
    ageInput,
    h('div', { class: 'age-ticks', 'aria-hidden': 'true' }, data.ball_ages.map((age) => h('span', { text: age }))),
  );
  const armControl = segmented({
    legend: 'Bowler',
    options: data.arms.map((arm) => ({ value: arm, label: armLabel(arm) })),
    value: state.arm,
    onChange: (arm) => setState({ arm }),
  });
  const cameraControl = segmented({
    legend: 'Camera',
    options: cameraOptions,
    value: cameraName,
    onChange: (name) => {
      cameraName = name;
      stage.setCamera(name);
    },
  });
  const replay = h('button', { type: 'button', class: 'button', text: 'Bowl again', onclick: () => bowl() });
  const controls = h(
    'form',
    { class: 'controls', 'aria-label': 'Delivery', onsubmit: (event) => event.preventDefault() },
    ageField, armControl.el, cameraControl.el,
    toggle({ label: 'Run-up', checked: runUp, onChange: (on) => { runUp = on; bowl(); } }),
    replay,
  );

  // One column per venue -------------------------------------------------
  const columns = keys.map((key, index) => {
    const venue = data.venues[key];
    const endControl = segmented({
      legend: `Bowling end at ${venue.name}`,
      hideLegend: true,
      className: 'end-toggle',
      options: ends.map((end) => ({ value: end, label: venue.ends[end] })),
      value: state.end,
      onChange: (end) => setState({ end }),
    });
    const viewport = h('div', { class: 'viewport', role: 'img' });
    const caption = createCaption(viewport);
    const card = h('div', { class: 'card' });
    const el = h(
      'article',
      { class: 'venue', style: `--venue:${venueColor(index)}` },
      h('header', { class: 'venue-head' },
        h('div', { class: 'venue-title' }, h('h2', { text: venue.name }), h('span', { class: 'venue-meta', text: venue.ball })),
        endControl.el),
      viewport,
      card,
    );
    return { key, venue, index, endControl, viewport, caption, card, el };
  });

  // The end-on chart and the notes ----------------------------------------
  const chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chart.setAttribute('class', 'endon');
  chart.setAttribute('role', 'img');
  const { meta } = data;
  const key = (name, label) => h('li', {}, h('span', { class: `key key-${name}` }), label);
  const aside = h(
    'aside',
    { class: 'stumps-panel' },
    h('header', { class: 'venue-head' },
      h('div', { class: 'venue-title' }, h('h2', { text: 'At the stumps' }), h('span', { class: 'venue-meta', text: 'From behind' })),
      h('ul', { class: 'plot-key' }, key('mean', 'Mean'), key('sample', 'Sample'), key('live', 'Live'))),
    h('div', { class: 'endon-frame' }, chart),
  );

  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const grid = h('div', { class: 'compare-grid', style: `--venues:${keys.length}` }, columns.map((c) => c.el), aside);
  const el = h('section', { class: 'compare', 'aria-label': 'Compare venues' }, controls, grid, live);

  // Rendering --------------------------------------------------------------
  function scenarios() {
    const ballAge = data.ball_ages[state.ageIndex];
    return columns.map((column) => ({
      column,
      scenario: findScenario(data, { venue: column.key, ballAge, arm: state.arm, end: state.end }),
    }));
  }

  // Bowls one sampled delivery in every panel. `forced` ({ action, outcome })
  // overrides what the data says, to preview an animation.
  function bowl(forced) {
    if (!active) return;
    bowled += 1;
    const round = bowled;
    const pick = Math.floor(Math.random() * 1e6);
    const entries = [];
    const finished = [];
    scenarios().forEach(({ column, scenario }) => {
      const { venue, caption, index, key } = column;
      caption.clear();
      if (!scenario) {
        stage.clearPlay(index);
        return;
      }
      const delivery = sample(scenario, pick);
      const action = forced?.action ?? scenario.best;
      const outcome = forced?.outcome ?? delivery.outcomes?.[action];
      const animation = animationFor(action, outcome);
      const words = { action: actionLabel(action), outcome: outcome ? outcomeLabel(outcome) : '', flash: animation.flash };
      stage.setPlay(index, {
        venue: key,
        arm: state.arm,
        path: delivery.path,
        bounceIndex: delivery.bounceIndex,
        color: venueColor(index),
        fan: delivery.others,
        mean: scenario.path,
        runUp,
        onEvent: () => caption.show(words),
        onCut: (tag) => caption.setTag(tag),
      });
      stage.setOutcome(index, animation);
      finished.push(stage.playTo(index, 'end').then((arrived) => arrived && `${venue.name}: ${words.action}, ${words.outcome.toLowerCase()}`));
      entries.push({
        name: venue.name,
        color: venueColor(index),
        end: lastPoint(scenario.path),
        fanEnds: (scenario.fan ?? []).map(lastPoint),
        picked: delivery.picked,
      });
    });
    const frame = chart.parentElement;
    renderEndOn(chart, constants, entries, frame.clientHeight > 0 ? frame.clientWidth / frame.clientHeight : undefined);
    chart.setAttribute('aria-label', `End-on chart of where the delivery passes the stumps at ${entries.map((e) => e.name).join(', ')}.`);
    Promise.all(finished).then((lines) => {
      if (round === bowled && lines.length > 0 && lines.every(Boolean)) live.textContent = `${lines.join('. ')}.`;
    });
  }

  function update() {
    const ballAge = data.ball_ages[state.ageIndex];
    ageInput.value = state.ageIndex;
    ageInput.setAttribute('aria-valuetext', overs(ballAge));
    ageOutput.textContent = overs(ballAge);
    armControl.set(state.arm);

    scenarios().forEach(({ column, scenario }) => {
      const { venue, card, viewport, endControl } = column;
      endControl.set(state.end);
      if (!scenario) {
        card.replaceChildren(h('p', { class: 'empty', text: 'The data file has no scenario for this case.' }));
        viewport.setAttribute('aria-label', `No delivery to show at ${venue.name}`);
        return;
      }
      const [x, z] = lastPoint(scenario.path);
      const passes = `${lineAtStumps(x, constants.stump_half_width)}, ${heightAtStumps(z, constants.stump_height)}`;
      viewport.setAttribute('aria-label', `3D view of a delivery at ${venue.name} with a ${venue.ball} ball. At the stumps the mean delivery is ${passes}.`);
      const open = card.querySelector('details')?.open ?? false; // keep the toggle as the visitor left it
      card.replaceChildren(
        actionTable(scenario),
        h('details', { class: 'more', open },
          h('summary', { text: 'Details' }),
          splitBar(scenario),
          h('p', { class: 'passes' }, 'Mean delivery at the stumps: ', h('b', { text: passes })),
          wicketCost(scenario, meta)),
      );
    });
    bowl();
  }

  return {
    el,
    preview: (action, outcome) => bowl({ action, outcome }),
    activate() {
      active = true;
      stage.mount(grid, columns.map((c) => c.viewport));
      stage.setCamera(cameraName);
      update();
    },
    deactivate() {
      active = false;
    },
  };
}

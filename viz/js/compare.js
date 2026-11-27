// Comparison view: the same release at every venue, side by side, for the
// selected ball age, bowler arm and bowling end.
import { h, segmented } from './dom.js';
import { endCount, findScenario, venueKeys } from './data.js';
import { armLabel, heightAtStumps, lineAtStumps, overs } from './format.js';
import { actionTable, splitBar, venueColor, wicketCost } from './numbers.js';
import { renderEndOn } from './endon.js';
import { cameraOptions } from './stage.js';

const SPEED = 30; // path points per second

export function createCompare(data, stage) {
  const { constants } = data.meta;
  const keys = venueKeys(data);
  const ends = Array.from({ length: endCount(data) }, (_, index) => index);
  let state = { ageIndex: 0, arm: data.arms[0], end: 0 };
  let cameraName = cameraOptions[0].value;

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
    ageField, armControl.el, cameraControl.el, replay,
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
    const viewport = h('div', { class: 'viewport', role: 'img' }, h('span', { class: 'viewport-caption', text: `${venue.ball} ball` }));
    const card = h('div', { class: 'card' });
    const el = h(
      'article',
      { class: 'venue', style: `--venue:${venueColor(index)}` },
      h('header', { class: 'venue-head' },
        h('h2', {}, h('span', { class: 'swatch' }), venue.name),
        endControl.el),
      viewport,
      card,
    );
    return { key, venue, index, endControl, viewport, card, el };
  });

  // The end-on chart and the notes ----------------------------------------
  const chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chart.setAttribute('class', 'endon');
  chart.setAttribute('role', 'img');
  const { meta } = data;
  const aside = h(
    'aside',
    { class: 'stumps-panel' },
    h('header', { class: 'venue-head' },
      h('h2', {}, 'At the stumps', h('small', { text: 'seen from behind' })),
      h('ul', { class: 'legend' },
        columns.map(({ venue, index }) =>
          h('li', { style: `--venue:${venueColor(index)}` }, h('span', { class: 'swatch' }), venue.name)))),
    h('div', { class: 'endon-frame' }, chart),
    h('div', { class: 'notes' },
      h('p', { text: 'Solid marks are the mean delivery. Faint rings and lines are sampled deliveries with random swing and seam deviation.' }),
      h('p', { text: 'Expected value is expected runs minus wicket cost times the probability of dismissal.' }),
      meta.wicket_cost_source === 'placeholder'
        && h('p', { class: 'note-warn', text: 'The wicket cost is a placeholder, not yet read from the run-expectancy table. The expected values will move when it is.' }),
      h('p', { class: 'fine', text: `Each estimate uses ${Number(meta.deliveries_per_estimate).toLocaleString('en-GB')} simulated deliveries, with ${meta.wickets_lost} wickets lost and ${Number(meta.runs_middled).toFixed(2)} runs for a middled delivery. The ball in the 3D views is drawn larger than life. Data generated ${meta.generated}.` })),
  );

  const grid = h('div', { class: 'compare-grid', style: `--venues:${keys.length}` }, columns.map((c) => c.el), aside);
  const el = h('section', { class: 'compare', 'aria-label': 'Compare venues' }, controls, grid);

  // Rendering --------------------------------------------------------------
  let active = false;

  function scenarios() {
    const ballAge = data.ball_ages[state.ageIndex];
    return columns.map((column) => ({
      column,
      scenario: findScenario(data, { venue: column.key, ballAge, arm: state.arm, end: state.end }),
    }));
  }

  function bowl() {
    if (!active) return;
    scenarios().forEach(({ column, scenario }) => {
      if (!scenario) return;
      const last = stage.setDelivery(column.index, {
        path: scenario.path,
        fan: scenario.fan ?? [],
        bounceIndex: scenario.bounce_index,
        color: venueColor(column.index),
      });
      stage.play(column.index, last, SPEED);
    });
  }

  function update() {
    const ballAge = data.ball_ages[state.ageIndex];
    ageInput.value = state.ageIndex;
    ageInput.setAttribute('aria-valuetext', overs(ballAge));
    ageOutput.textContent = overs(ballAge);
    armControl.set(state.arm);

    const entries = [];
    scenarios().forEach(({ column, scenario }) => {
      const { venue, card, viewport, endControl, index } = column;
      endControl.set(state.end);
      if (!scenario) {
        card.replaceChildren(h('p', { class: 'empty', text: 'The data file has no scenario for this case.' }));
        viewport.setAttribute('aria-label', `No delivery to show at ${venue.name}`);
        return;
      }
      const [x, , z] = scenario.path[scenario.path.length - 1];
      const passes = `${lineAtStumps(x, constants.stump_half_width)}, ${heightAtStumps(z, constants.stump_height)}`;
      viewport.setAttribute('aria-label', `3D view of the delivery at ${venue.name} with a ${venue.ball} ball. At the stumps it is ${passes}.`);
      card.replaceChildren(
        actionTable(scenario),
        splitBar(scenario),
        h('p', { class: 'passes' }, 'At the stumps ', h('b', { text: passes })),
        wicketCost(scenario, meta),
      );
      entries.push({
        name: venue.name,
        color: venueColor(index),
        end: [x, z],
        fanEnds: (scenario.fan ?? []).map((sample) => {
          const [fx, , fz] = sample[sample.length - 1];
          return [fx, fz];
        }),
      });
    });
    renderEndOn(chart, constants, entries);
    chart.setAttribute('aria-label', `End-on chart of where the delivery passes the stumps at ${entries.map((e) => e.name).join(', ')}.`);
    bowl();
  }

  return {
    el,
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

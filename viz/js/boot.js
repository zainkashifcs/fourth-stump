// The boot overlay: a teletext BIOS screen whose diagnostic lines follow real
// loading promises. It sits over the page while the page builds underneath,
// never blocks it, and goes when loading has settled and a short minimum has
// passed, or at once on any click or key.
import { h } from './dom.js';

const MINIMUM = 1400; // milliseconds on screen
const WIPE = 420; // length of the raster wipe out, matches the CSS animation
const STATES = { pending: '[..]', ok: '[OK]', failed: '[FAIL]' };

// steps: [{ promise, label(value) }] where label gets the resolved value, or
// undefined while the promise is pending or after it has failed.
export function createBoot({ title, steps, onShow }) {
  const tracked = steps.map((step) => ({ ...step, state: 'pending', value: undefined }));
  const lines = tracked.map(() => h('p', { class: 'boot-line' }));
  const skip = h('button', { type: 'button', class: 'button boot-skip', text: 'Skip' });
  const el = h(
    'div',
    { class: 'boot', role: 'status', 'aria-label': 'Starting up' },
    h('div', { class: 'boot-screen' }, h('p', { class: 'boot-title', text: title }), lines, skip),
  );
  let timers = [];
  let showing = 0; // counts shows, so a replay is not ended by the timer of the show before it

  function paint() {
    tracked.forEach((step, index) => {
      lines[index].className = `boot-line is-${step.state}`;
      lines[index].replaceChildren(h('span', { class: 'boot-state', text: STATES[step.state] }), ` ${step.label(step.value)}`);
    });
  }

  // handlers go on at once, so a failed step is never an unhandled rejection
  const settled = Promise.all(tracked.map((step) => step.promise.then(
    (value) => Object.assign(step, { state: 'ok', value }),
    () => Object.assign(step, { state: 'failed' }),
  ).then(paint)));

  function remove() {
    timers.forEach(clearTimeout);
    timers = [];
    document.removeEventListener('keydown', remove, true);
    el.removeEventListener('click', remove);
    el.classList.remove('is-leaving');
    el.remove();
  }

  function leave() {
    el.classList.add('is-leaving');
    timers.push(setTimeout(remove, WIPE));
  }

  function show() {
    remove();
    paint();
    document.body.append(el);
    document.addEventListener('keydown', remove, true);
    el.addEventListener('click', remove);
    onShow?.();
    showing += 1;
    const mine = showing;
    const minimum = new Promise((resolve) => { timers.push(setTimeout(resolve, MINIMUM)); });
    Promise.all([settled, minimum]).then(() => {
      if (mine === showing && el.isConnected) leave();
    });
  }

  return { show };
}

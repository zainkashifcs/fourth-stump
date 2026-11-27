// The boot overlay: a teletext BIOS screen whose diagnostic lines follow real
// loading promises. It sits over the page while the page builds underneath,
// never blocks it, and goes when loading has settled and a short minimum has
// passed, or at once on any click or key. A replay, asked for once everything
// has loaded, paces the lines itself and lasts about three seconds.
import { h } from './dom.js';

const MINIMUM = 1400; // milliseconds on screen
const WIPE = 420; // length of the raster wipe out, matches the CSS animation
const STATES = { pending: '[..]', ok: '[OK]', failed: '[FAIL]' };

// When each line of a replay appears, when READY shows (with the chime) and
// when the wipe starts and ends, in milliseconds from the start.
export function replaySchedule(lineCount, { perLine = 500, hold = 550, wipe = WIPE } = {}) {
  const lines = Array.from({ length: lineCount }, (_, index) => index * perLine);
  const ready = lineCount * perLine;
  return { lines, ready, wipe: ready + hold, end: ready + hold + wipe };
}

// steps: [{ promise, label(value) }] where label gets the resolved value, or
// undefined while the promise is pending or after it has failed.
// onReady: called when READY shows (silent until a gesture has unlocked audio).
export function createBoot({ title, steps, onReady }) {
  const tracked = steps.map((step) => ({ ...step, state: 'pending', value: undefined }));
  const lines = tracked.map(() => h('p', { class: 'boot-line' }));
  const readyLine = h('p', { class: 'boot-ready', text: 'READY.', hidden: true });
  const skip = h('button', { type: 'button', class: 'button boot-skip', text: 'Skip' });
  const el = h(
    'div',
    { class: 'boot', role: 'status', 'aria-label': 'Starting up' },
    h('div', { class: 'boot-screen' }, h('p', { class: 'boot-title', text: title }), lines, readyLine, skip),
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
    el.classList.remove('is-leaving', 'is-replay');
    lines.forEach((line) => { line.hidden = false; });
    readyLine.hidden = true;
    el.remove();
  }

  function ready() {
    if (!readyLine.hidden) return;
    readyLine.hidden = false;
    onReady?.();
  }

  function leave() {
    ready();
    el.classList.add('is-leaving');
    timers.push(setTimeout(remove, WIPE));
  }

  function open() {
    remove();
    paint();
    document.body.append(el);
    document.addEventListener('keydown', remove, true);
    el.addEventListener('click', remove);
    showing += 1;
    return showing;
  }

  // The first load: lines settle with the real promises.
  function show() {
    const mine = open();
    const minimum = new Promise((resolve) => { timers.push(setTimeout(resolve, MINIMUM)); });
    Promise.all([settled, minimum]).then(() => {
      if (mine === showing && el.isConnected) leave();
    });
  }

  // A replay: one line every half second, READY and the chime, then the wipe.
  function replay() {
    open();
    el.classList.add('is-replay');
    const at = replaySchedule(lines.length);
    lines.forEach((line, index) => {
      line.hidden = true;
      timers.push(setTimeout(() => { line.hidden = false; }, at.lines[index]));
    });
    timers.push(setTimeout(ready, at.ready), setTimeout(leave, at.wipe));
  }

  return { show, replay };
}

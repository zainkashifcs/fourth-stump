// The commentator: one line for each outcome, shown as a caption in the
// picture and, while sound is on, spoken with the browser's speech synthesis.
// In Compare venues three panels bowl at once; each shows its own line, but
// only the most dramatic is spoken.
//
// `LINES`, `kindOf`, `mostDramatic` and `pickVoice` are pure and tested under
// node; nothing at the top of this module touches the browser.
import { animationFor } from './outcomes.js';
import { outcomeLabel } from './format.js';

// keyed by animation name (outcomes.js)
export const LINES = {
  bowled: 'Bowled him! Right through the gate, timber everywhere!',
  'edged-caught': 'Edged and taken! Straight into the cordon!',
  'edged-short': 'Thick outside edge, falls just short of the slips!',
  'left-alone': 'Good leave outside off stump, watches it all the way.',
  middled: 'Solidly behind the line, dead-batted into the off side.',
  'play-and-miss': 'Beaten! Past the outside edge.',
};

const DRAMA = ['bowled', 'edged-caught', 'edged-short', 'play-and-miss', 'middled', 'left-alone'];

// The captions are handed the outcome's words, so read the animation back from them.
const PAIRS = [['leave', 'safe'], ['leave', 'bowled'], ['play', 'middled'], ['play', 'edged_safe'], ['play', 'edged_caught'], ['play', 'missed'], ['play', 'missed_bowled']];
const KIND_BY_LABEL = Object.fromEntries(PAIRS.map(([action, outcome]) => [outcomeLabel(outcome), animationFor(action, outcome).name]));

export const kindOf = (words) => KIND_BY_LABEL[words?.outcome] ?? null;

export function mostDramatic(kinds) {
  const ranked = kinds.filter((kind) => DRAMA.includes(kind)).sort((a, b) => DRAMA.indexOf(a) - DRAMA.indexOf(b));
  return ranked[0] ?? null;
}

// An English (UK) voice when the browser has one, otherwise its default (null).
export const pickVoice = (voices) => voices.find((voice) => voice.lang?.replace('_', '-') === 'en-GB') ?? null;

const WAIT = 1500; // milliseconds a round waits for slower panels before speaking what it has

let soundOn = false;
let round = null; // { waiting: Set, kinds: [], spoken, timer }
let opening = false; // captions cleared in one task belong to one round

const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : undefined);

function hush() {
  synth()?.cancel();
}

function speak(text) {
  const speech = synth();
  if (!speech || typeof SpeechSynthesisUtterance === 'undefined') return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-GB';
  utterance.voice = pickVoice(speech.getVoices());
  utterance.rate = 1.05;
  speech.speak(utterance);
}

function say(r) {
  if (r.spoken) return;
  r.spoken = true;
  clearTimeout(r.timer);
  const line = LINES[mostDramatic(r.kinds)];
  if (line && soundOn) speak(line);
}

export function setCommentarySound(on) {
  soundOn = on;
  if (!on) hush();
}

// A caption was cleared: a new delivery is starting in its view.
export function deliveryStarts(view) {
  hush();
  if (!opening) {
    opening = true;
    clearTimeout(round?.timer);
    round = { waiting: new Set(), kinds: [], spoken: false, timer: null };
    queueMicrotask(() => { opening = false; });
  }
  round.waiting.add(view);
}

// A caption showed its outcome; speak once every view in the round has.
export function outcomeShown(view, kind) {
  if (!round || round.spoken || !round.waiting.has(view)) return;
  round.waiting.delete(view);
  round.kinds.push(kind);
  const r = round;
  r.timer ??= setTimeout(() => say(r), WAIT);
  // with reduced motion a view can show its outcome before the next view has even started
  queueMicrotask(() => { if (r.waiting.size === 0) say(r); });
}

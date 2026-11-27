// The commentator: a line for each outcome in the cadence of a Test-match
// broadcast, a short lifted call, a breath, then the descriptive clause. The
// ticker in each picture shows the call at once and adds the clause when it is
// spoken. While sound is on, the line is played from clips recorded offline
// (assets/audio/commentary/, see viz/audio/generate_commentary.py) through a broadcast
// microphone chain in audio.js; if a clip cannot be had, the browser's speech
// synthesis says the same beats, and failing that the ticker alone carries it.
// In Compare venues three panels bowl at once; each shows its own line and
// nothing is spoken; a single view (a replayed venue, the game, the live
// engine) has its line spoken.
//
// Everything above the runtime section is pure and tested under node; nothing
// at the top of this module touches the browser.
import { animationFor } from './outcomes.js';
import { outcomeLabel } from './format.js';

// line id -> { beats, gap }: the beats as shown (the clips say the same words), and the
// breath between them in milliseconds. Clip files are named `${id}-${beat}.mp3`.
export const LINES = {
  bowled: { gap: 180, beats: ['BOWLED HIM!', 'Right through the gate, off stump out of the ground, timber everywhere!'] },
  'bowled-yorker': { gap: 160, beats: ['IN THE BLOCKHOLE, CLEAN BOWLED!', 'Toe-crushing yorker right on the fourth-stump line!'] },
  'edged-caught': { gap: 160, beats: ['EDGED AND GONE!', 'Thin feather outside off, swallowed cleanly in the slips!'] },
  'edged-short': { gap: 0, beats: ['Ooh, thick outside edge, drops agonizingly short of second slip!'] },
  'left-alone': { gap: 0, beats: ['Shouldered arms, judged to perfection on the fourth-stump line, watches it carry through.'] },
  'left-alone-bouncer': { gap: 0, beats: ['Sways out of the road, sharp bumper in the corridor, well left alone.'] },
  middled: { gap: 0, beats: ['Right behind the line, crisp, authoritative forward defensive into the covers.'] },
  'play-and-miss': { gap: 160, beats: ['BEATEN!', 'Lovely shape away off the seam, squared him up, past the outside edge.'] },
};

// A length with its own line for an outcome; any other length takes the good-length line.
const BY_LENGTH = { 'bowled:yorker': 'bowled-yorker', 'left-alone:bouncer': 'left-alone-bouncer' };

// The line for an outcome (an animation name from outcomes.js) and the delivery's length
// ('good' | 'yorker' | 'bouncer'), or null when there is none.
export function lineFor(kind, length = 'good') {
  const id = BY_LENGTH[`${kind}:${length}`] ?? kind;
  return LINES[id] ? { id, ...LINES[id] } : null;
}

const DRAMA = ['bowled', 'edged-caught', 'edged-short', 'play-and-miss', 'middled', 'left-alone'];
const DISMISSALS = new Set(['bowled', 'edged-caught']);

// The captions are handed the outcome's words, so read the animation back from them.
const PAIRS = [['leave', 'safe'], ['leave', 'bowled'], ['play', 'middled'], ['play', 'edged_safe'], ['play', 'edged_caught'], ['play', 'missed'], ['play', 'missed_bowled']];
const KIND_BY_LABEL = Object.fromEntries(PAIRS.map(([action, outcome]) => [outcomeLabel(outcome), animationFor(action, outcome).name]));

export const kindOf = (words) => KIND_BY_LABEL[words?.outcome] ?? null;

export function mostDramatic(kinds) {
  const ranked = kinds.filter((kind) => DRAMA.includes(kind)).sort((a, b) => DRAMA.indexOf(a) - DRAMA.indexOf(b));
  return ranked[0] ?? null;
}

// Speech synthesis voices, best first: English (UK), then Australian, then any other English.
const tagOf = (voice) => voice.lang?.replace('_', '-') ?? '';
export function rankVoices(voices) {
  const rank = (voice) => {
    const tag = tagOf(voice);
    if (tag === 'en-GB') return 0;
    if (tag === 'en-AU') return 1;
    return tag.startsWith('en') ? 2 : 3;
  };
  return voices.filter((voice) => rank(voice) < 3).sort((a, b) => rank(a) - rank(b));
}
export const pickVoice = (voices) => rankVoices(voices)[0] ?? null;

// The call is a touch quicker and higher than the clause.
export const BEAT_RATES = [1.03, 1];
export const SPEECH_BEATS = [{ pitch: 1.15, rate: 1.1 }, { pitch: 0.98, rate: 1 }];
const SINGLE = { rate: 1, speech: { pitch: 1, rate: 1 } };

// When each beat starts and how long it lasts, in seconds, given each clip's length at
// normal speed: the second beat waits for the first to end and the breath to pass.
export function beatPlan(seconds, gapMs, rates = seconds.length > 1 ? BEAT_RATES : [SINGLE.rate]) {
  let at = 0;
  return seconds.map((length, index) => {
    const beat = { at, seconds: length / rates[index], rate: rates[index] };
    at += beat.seconds + gapMs / 1000;
    return beat;
  });
}

// About how long a call takes to say, for the ticker when nothing is speaking it.
export const estimateSeconds = (text) => 0.25 + 0.052 * text.length;

// Whether a round of deliveries is spoken: only when one view bowls on its own. Three
// venues bowling at once would talk over each other, so their tickers carry the words.
export const speechAllowed = (views) => views === 1;

// The level of the crowd under the commentator: down a little while he speaks, and on a
// dismissal up again in the breath after the call. [seconds from the first beat, gain].
export const DUCK = 0.6;
export const SWELL = 1.3;
export function crowdEnvelope(plan, dismissal) {
  const last = plan[plan.length - 1];
  const end = last.at + last.seconds;
  const points = [[0, 1], [0.08, DUCK]];
  if (dismissal && plan.length > 1) {
    const called = plan[0].at + plan[0].seconds;
    points.push([called, DUCK], [plan[1].at, SWELL], [plan[1].at + 0.35, DUCK]);
  }
  points.push([end, DUCK], [end + 0.6, 1]);
  return points;
}

// Where the speech is in a decoded clip: the first and last samples above the threshold,
// so the encoder's padding never stretches the breath.
export function speechBounds(samples, sampleRate, threshold = 0.003, margin = 0.01) {
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) <= threshold) first += 1;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) <= threshold) last -= 1;
  if (first >= samples.length) return { offset: 0, seconds: 0 };
  const start = Math.max(first / sampleRate - margin, 0);
  const end = Math.min((last + 1) / sampleRate + margin, samples.length / sampleRate);
  return { offset: start, seconds: end - start };
}

// Runtime ---------------------------------------------------------------------

let soundOn = false;
let audio = null; // { context(), voiceInput(), duckCrowd(points, start) } from audio.js
let round = null; // { waiting: Set of views yet to show, members: Set of views, reveals }
let opening = false; // captions cleared in one task belong to one round
let ticket = 0; // bumped whenever speech must stop, so late callbacks know they are stale
let playing = []; // buffer sources and timers of the line now being said
const clips = new Map(); // file -> Promise<AudioBuffer>

const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : undefined);

export const lastSpoken = { line: null, via: null }; // for checking in the browser

function hush() {
  ticket += 1;
  synth()?.cancel();
  playing.forEach((item) => (typeof item === 'number' ? clearTimeout(item) : item.stop()));
  playing = [];
  audio?.duckCrowd([]);
}

function later(fn, ms) {
  playing.push(setTimeout(fn, Math.max(ms, 0)));
}

function clip(context, file) {
  if (!clips.has(file)) {
    const url = new URL(`../assets/audio/commentary/${file}`, import.meta.url);
    clips.set(file, fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${file}: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes))
      .catch((error) => {
        clips.delete(file); // a later delivery tries again
        throw error;
      }));
  }
  return clips.get(file);
}

async function playClips(line, reveal, mine) {
  const context = audio?.context();
  if (!context) throw new Error('no audio context');
  const buffers = await Promise.all(line.beats.map((_, index) => clip(context, `${line.id}-${index + 1}.mp3`)));
  if (mine !== ticket) return;
  const bounds = buffers.map((buffer) => speechBounds(buffer.getChannelData(0), buffer.sampleRate));
  const plan = beatPlan(bounds.map((b) => b.seconds), line.gap);
  const start = context.currentTime + 0.03;
  plan.forEach((beat, index) => {
    const source = context.createBufferSource();
    source.buffer = buffers[index];
    source.playbackRate.value = beat.rate;
    source.connect(audio.voiceInput());
    source.start(start + beat.at, bounds[index].offset, bounds[index].seconds);
    playing.push(source);
  });
  audio.duckCrowd(crowdEnvelope(plan, DISMISSALS.has(line.kind)), start);
  if (plan.length > 1) later(reveal, (start + plan[1].at - context.currentTime) * 1000);
  Object.assign(lastSpoken, { line: line.id, via: 'clips', plan: plan.map((b) => ({ at: start + b.at, seconds: b.seconds })) });
}

function speakBeats(line, reveal, mine) {
  const speech = synth();
  if (!speech || typeof SpeechSynthesisUtterance === 'undefined') {
    later(reveal, (estimateSeconds(line.beats[0]) * 1000) + line.gap);
    return;
  }
  const voice = pickVoice(speech.getVoices());
  const say = (index) => {
    if (mine !== ticket) return;
    const utterance = new SpeechSynthesisUtterance(line.beats[index]);
    const shape = line.beats.length > 1 ? SPEECH_BEATS[index] : SINGLE.speech;
    Object.assign(utterance, { lang: voice?.lang ?? 'en-GB', voice, pitch: shape.pitch, rate: shape.rate });
    if (index === 0 && line.beats.length > 1) utterance.onend = () => later(() => say(1), line.gap);
    if (index === 1) utterance.onstart = reveal;
    speech.speak(utterance);
  };
  say(0);
  Object.assign(lastSpoken, { line: line.id, via: 'speech' });
}

function say(line, reveal) {
  const mine = ticket;
  playClips(line, reveal, mine).catch(() => {
    if (mine === ticket) speakBeats(line, reveal, mine); // no clips: the browser's voice says it
  });
}

export function setCommentarySound(on) {
  soundOn = on;
  if (on) return;
  hush();
  round?.reveals.forEach((reveal) => reveal()); // the ticker finishes the line in silence
}

// audio.js hands over its context, the microphone chain and the crowd level.
export function connectCommentary(api) {
  audio = api;
}

// A caption was cleared: a new delivery is starting in its view.
export function deliveryStarts(view) {
  hush();
  if (!opening) {
    opening = true;
    round = { waiting: new Set(), members: new Set(), reveals: [] };
    queueMicrotask(() => { opening = false; });
  }
  round.waiting.add(view);
  round.members.add(view);
}

// A caption showed its outcome and its first beat; `reveal` adds the second, when it is
// spoken or, in silence, about when it would have been.
export function outcomeShown(view, kind, length, reveal) {
  if (!round || !round.waiting.has(view)) {
    reveal();
    return;
  }
  const r = round;
  r.waiting.delete(view);
  r.reveals.push(reveal);
  const line = lineFor(kind, length);
  // decided once every view cleared in the same task has joined the round: with reduced
  // motion a view shows its outcome before the next view has even started
  queueMicrotask(() => {
    if (r !== round) return;
    if (soundOn && line && speechAllowed(r.members.size)) say({ ...line, kind }, reveal);
    else if (line?.beats.length > 1) later(reveal, estimateSeconds(line.beats[0]) * 1000 + line.gap);
  });
}

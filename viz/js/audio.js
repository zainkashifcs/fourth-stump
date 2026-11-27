// Sound: the ball, bat, stumps and gloves are synthesised with Web Audio; the
// crowd plays recorded clips from assets/audio/ (made offline, see
// viz/audio/), with the old synthesised crowd as the fallback when a clip
// cannot be had; the commentary (commentary.js) plays through a broadcast
// microphone chain built here. The audio context is only created or resumed
// inside a user gesture, clips are fetched then and not before, and the choice
// of on or off is remembered. Every crowd sound goes through one bus that
// ducks under the commentator.
//
// `cuesFor`, `clapTimes`, `saturationCurve` and `reactionFor` are pure and
// tested under node; nothing at the top of this module touches the browser.
import { connectCommentary, mostDramatic, setCommentarySound } from './commentary.js';

// Seconds from the ball passing the stumps to the keeper taking it 1.4 m behind them:
// the line runs on at the animation's slow-motion pace of 13 m of path a second (play.js).
export const TAKE = 1.4 / 13;

// Which sounds an outcome animation makes (names from outcomes.js), and when,
// in seconds from the moment the ball meets the bat or reaches the stumps.
// A cue must fall inside the delivery's tail (play.js) or it never fires.
// Each outcome has one crowd reaction, the last cue.
const CUES = {
  'left-alone': [{ sound: 'whoosh', at: -0.1 }, { sound: 'glove', at: TAKE }, { sound: 'crowd-leave', at: 0.2 }],
  'play-and-miss': [{ sound: 'whoosh', at: -0.1 }, { sound: 'glove', at: TAKE }, { sound: 'crowd-oooo', at: 0.05 }],
  middled: [{ sound: 'middled', at: 0 }, { sound: 'crowd-applause', at: 0.35 }],
  'edged-short': [{ sound: 'nick', at: 0 }, { sound: 'crowd-oooo', at: 0.08 }],
  'edged-caught': [{ sound: 'nick', at: 0 }, { sound: 'glove', at: 0.42 }, { sound: 'crowd-roar', at: 0.45 }],
  bowled: [{ sound: 'timber', at: 0 }, { sound: 'bails', at: 0.04 }, { sound: 'crowd-roar', at: 0.12 }],
};

export const cuesFor = (animationName) => CUES[animationName] ?? [];

// The crowd's reaction to a round in which several views bowl at once: the one for the
// most dramatic outcome, so three reactions never stack. Null when there is none.
export function reactionFor(kinds) {
  const kind = mostDramatic(kinds);
  return cuesFor(kind).find((cue) => cue.sound.startsWith('crowd-'))?.sound ?? null;
}

// When the hand claps in a burst of applause fall: about `perSecond` a second
// at full swell, building over the first 15% and thinning over the last 45%,
// each with its own loudness, length and brightness so it reads as many hands.
export function clapTimes(seconds, perSecond, random = Math.random) {
  const SLOT = 0.01;
  const claps = [];
  for (let slot = 0; slot < seconds; slot += SLOT) {
    const q = slot / seconds;
    const rate = perSecond * Math.min(1, q / 0.15) * (q > 0.55 ? (1 - q) / 0.45 : 1);
    const count = Math.floor(rate * SLOT + random());
    for (let i = 0; i < count; i += 1) {
      claps.push({ at: slot + random() * SLOT, gain: 0.35 + 0.65 * random(), length: 0.006 + 0.012 * random(), bright: random() });
    }
  }
  return claps.sort((a, b) => a.at - b.at);
}

// A gentle odd-harmonic saturation for the microphone chain: tanh, scaled so a full-scale
// input still comes out at full scale. `drive` near 1 is very light.
export function saturationCurve(points = 1024, drive = 1.6) {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
}

const STORAGE_KEY = 'fourth-stump:sound';

// A wooden bail striking: a high-Q ring (a decaying sine is a resonator's
// impulse response) over a short noise click at the same pitch.
const clack = (frequency, at, gain) => [
  { tone: 'sine', from: frequency, to: frequency * 0.985, at, length: 0.06, gain },
  { noise: 'bandpass', frequency, q: 8, at, length: 0.014, gain: gain * 1.6 },
];
const later = (parts, by) => parts.map((part) => ({ ...part, at: part.at + by }));

// Each voice is a list of parts: an oscillator sweep ("tone"), filtered noise,
// or a burst of hand claps. Times in seconds, frequencies in hertz, `gain` the
// peak level; a `swell` part rises to its peak at `peakAt` of its length.
const VOICES = {
  chime: [
    { tone: 'sine', from: 392, to: 392, at: 0, length: 0.5, gain: 0.12 },
    { tone: 'sine', from: 587, to: 587, at: 0.12, length: 0.55, gain: 0.1 },
    { tone: 'triangle', from: 784, to: 784, at: 0.24, length: 0.6, gain: 0.07 },
  ],
  bounce: [
    { tone: 'sine', from: 120, to: 60, at: 0, length: 0.1, gain: 0.3 },
    { noise: 'lowpass', frequency: 500, q: 0.7, at: 0, length: 0.05, gain: 0.12 },
  ],
  // the ball into an ash stump: a deep body that drops in pitch, a crack of wood and a thud,
  // then the stumps rattling against each other in the ground
  timber: [
    { tone: 'sine', from: 195, to: 78, at: 0, length: 0.5, gain: 0.55 },
    { tone: 'triangle', from: 390, to: 156, at: 0, length: 0.14, gain: 0.16 },
    { noise: 'bandpass', frequency: 1100, q: 2.5, at: 0, length: 0.04, gain: 0.7 },
    { noise: 'lowpass', frequency: 380, q: 0.7, at: 0, length: 0.09, gain: 0.25 },
    ...[0.05, 0.09, 0.14, 0.2].map((at, i) => ({ noise: 'bandpass', frequency: [640, 820, 560, 720][i], q: 6, at, length: 0.035, gain: 0.32 - i * 0.06 })),
    ...[0.05, 0.09, 0.14].map((at, i) => ({ tone: 'triangle', from: [310, 360, 280][i], to: [290, 330, 260][i], at, length: 0.05, gain: 0.12 - i * 0.03 })),
  ],
  // both bails pop out of the grooves, knock together, then land and tumble on the turf (40 to 480 ms after the stump)
  bails: [
    ...clack(2150, 0, 0.16),
    ...clack(1620, 0.035, 0.15),
    ...clack(1980, 0.11, 0.11),
    ...clack(1480, 0.19, 0.09),
    ...clack(1760, 0.3, 0.06),
    ...clack(1350, 0.44, 0.045),
  ],
  // an edge: a sharp, thin click with nothing below 3.5 kHz
  nick: [
    { noise: 'highpass', frequency: 3500, q: 0.7, at: 0, length: 0.012, gain: 0.9 },
    { noise: 'bandpass', frequency: 5200, q: 6, at: 0, length: 0.03, gain: 0.5 },
    { tone: 'sine', from: 4300, to: 4100, at: 0, length: 0.025, gain: 0.05 },
  ],
  // the keeper's gloves closing on the ball: a padded thump with a leather slap on top
  glove: [
    { tone: 'sine', from: 150, to: 85, at: 0, length: 0.12, gain: 0.45 },
    { noise: 'lowpass', frequency: 650, q: 0.9, at: 0, length: 0.07, gain: 0.3 },
    { noise: 'bandpass', frequency: 1400, q: 1.4, at: 0, length: 0.018, gain: 0.25 },
  ],
  // the middle of the bat: a crack of wood, then the willow ringing at about 850 Hz and 2.2 kHz
  middled: [
    { noise: 'highpass', frequency: 1800, q: 0.7, at: 0, length: 0.008, gain: 0.8 },
    { noise: 'bandpass', frequency: 850, q: 9, at: 0, length: 0.16, gain: 0.9 },
    { noise: 'bandpass', frequency: 2200, q: 11, at: 0, length: 0.11, gain: 0.55 },
    { tone: 'sine', from: 850, to: 830, at: 0, length: 0.14, gain: 0.12 },
    { tone: 'sine', from: 140, to: 95, at: 0, length: 0.09, gain: 0.25 },
  ],
  whoosh: [{ noise: 'bandpass', frequency: 600, sweepTo: 1900, q: 1.1, at: 0, length: 0.3, gain: 0.1, swell: true }],
  // the synthesised crowd: the fallback for the recorded reactions
  roar: [
    { noise: 'bandpass', frequency: 420, sweepTo: 650, q: 0.6, at: 0, length: 3.2, gain: 0.3, swell: true, peakAt: 0.12 },
    { noise: 'lowpass', frequency: 900, q: 0.5, at: 0.05, length: 2.6, gain: 0.12, swell: true, peakAt: 0.15 },
  ],
  applause: [{ claps: 90, frequency: 1500, q: 0.6, at: 0, length: 3.6, gain: 0.26 }],
  'crisp-applause': [{ claps: 40, frequency: 2100, q: 0.8, at: 0, length: 1.6, gain: 0.2 }],
  'pavilion-claps': [{ claps: 11, frequency: 1700, q: 0.7, at: 0, length: 1.8, gain: 0.16 }],
  // a collective "ooh": breath through the two formants of the vowel, falling as it fades
  ooh: [
    { noise: 'bandpass', frequency: 330, sweepTo: 270, q: 5, at: 0, length: 1.5, gain: 0.5, swell: true, peakAt: 0.4 },
    { noise: 'bandpass', frequency: 820, sweepTo: 660, q: 6, at: 0, length: 1.5, gain: 0.3, swell: true, peakAt: 0.4 },
  ],
};
// the crowd's reactions, each a recorded clip with a synthesised stand-in
const REACTIONS = {
  'crowd-roar': { clip: 'crowd_roar.ogg', gain: 0.9, fallback: [...VOICES.roar, ...later(VOICES.applause, 0.48)] },
  'crowd-oooo': { clip: 'crowd_oooo.ogg', gain: 0.8, fallback: VOICES.ooh },
  'crowd-applause': { clip: 'crowd_applause.ogg', gain: 0.75, fallback: VOICES['crisp-applause'] },
  'crowd-leave': { clip: 'crowd_leave.ogg', gain: 0.7, fallback: VOICES['pavilion-claps'] },
};
const BED = { clip: 'crowd_bed.ogg', gain: 0.32 };
Object.entries(REACTIONS).forEach(([name, reaction]) => { VOICES[name] = reaction.fallback; });

const CROWD_GAP = 1; // seconds: one reaction of a kind at a time is enough
const MURMUR_LEVEL = 0.018;

export const soundNames = Object.keys(VOICES);

// Set by Compare venues while three views bowl at once: the one crowd reaction allowed.
let roundReaction = null;
export function setCrowdRound(kinds) {
  roundReaction = kinds ? reactionFor(kinds) : null;
}

function remembered() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true; // storage blocked: default on, just not remembered
  }
}

function remember(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch { /* storage blocked */ }
}

export function createAudio() {
  let enabled = remembered();
  let context = null;
  let noiseBuffer = null;
  let murmur = null; // { stop(), recorded } while the crowd murmurs
  let crowd = null; // the gain every crowd sound goes through, so it can duck under the voice
  let microphone = null; // the input of the commentator's microphone chain
  const clips = {}; // file -> AudioBuffer, or null once it has failed
  const lastCrowd = {};
  const history = []; // the last sounds scheduled, for checking by hand and in the browser test

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button sound-toggle';

  function paint() {
    button.textContent = `[ SOUND: ${enabled ? 'ON' : 'OFF'} ]`;
    button.setAttribute('aria-pressed', String(enabled));
    setCommentarySound(enabled);
  }

  function log(name) {
    history.push(name);
    if (history.length > 60) history.shift();
  }

  // Fetches and decodes the crowd clips once, on the first gesture with sound on.
  function loadClips() {
    [...Object.values(REACTIONS), BED].forEach(({ clip }) => {
      if (clip in clips) return;
      clips[clip] = undefined;
      fetch(new URL(`../assets/audio/${clip}`, import.meta.url))
        .then((response) => {
          if (!response.ok) throw new Error(`${clip}: ${response.status}`);
          return response.arrayBuffer();
        })
        .then((bytes) => context.decodeAudioData(bytes))
        .then((buffer) => {
          clips[clip] = buffer;
          if (clip === BED.clip && murmur && !murmur.recorded) {
            stopMurmur();
            startMurmur();
          }
        })
        .catch(() => { clips[clip] = null; }); // the synthesised crowd stands in
    });
  }

  // Runs inside a user gesture only: browsers refuse to start audio otherwise.
  function unlock() {
    if (!enabled) return;
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    if (context.state === 'suspended') context.resume();
    loadClips();
    startMurmur();
  }

  function noise() {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  // Renders a burst of applause into a buffer, normalised to a peak of one.
  function clapBuffer(seconds, perSecond) {
    const rate = context.sampleRate;
    const buffer = context.createBuffer(1, Math.ceil(rate * seconds), rate);
    const samples = buffer.getChannelData(0);
    clapTimes(seconds, perSecond).forEach((clap) => {
      const first = Math.floor(clap.at * rate);
      const length = Math.floor(clap.length * rate);
      let previous = 0;
      for (let j = 0; j < length && first + j < samples.length; j += 1) {
        const white = Math.random() * 2 - 1;
        const envelope = (1 - Math.exp(-j / (rate * 0.0007))) * Math.exp(-j / (length * 0.3));
        samples[first + j] += clap.gain * envelope * (white - clap.bright * previous); // a brighter clap is more high-passed
        previous = white;
      }
    });
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
    for (let i = 0; i < samples.length; i += 1) samples[i] /= peak;
    return buffer;
  }

  function filtered(type, frequency, q, start) {
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, start);
    return filter;
  }

  function crowdBus() {
    if (!crowd) {
      crowd = context.createGain();
      crowd.connect(context.destination);
    }
    return crowd;
  }

  // The commentator's microphone: no rumble below 120 Hz, a presence lift at 2.5 kHz,
  // a little saturation and light compression.
  function voiceInput() {
    if (!microphone) {
      const highpass = filtered('highpass', 120, 0.7, 0);
      const presence = filtered('peaking', 2500, 1, 0);
      presence.gain.value = 4;
      const shaper = context.createWaveShaper();
      shaper.curve = saturationCurve();
      shaper.oversample = '2x';
      const compressor = context.createDynamicsCompressor();
      Object.entries({ threshold: -20, knee: 6, ratio: 3, attack: 0.005, release: 0.15 })
        .forEach(([name, value]) => { compressor[name].value = value; });
      const level = context.createGain();
      level.gain.value = 0.85;
      highpass.connect(presence).connect(shaper).connect(compressor).connect(level).connect(context.destination);
      microphone = highpass;
    }
    return microphone;
  }

  // points: [[seconds after start, gain]], from commentary.js; none puts the crowd back.
  function duckCrowd(points, start = 0) {
    if (!context || !crowd) return;
    const { gain } = crowd;
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    if (points.length === 0) gain.linearRampToValueAtTime(1, now + 0.2);
    points.forEach(([at, value]) => gain.linearRampToValueAtTime(value, Math.max(start + at, now)));
  }

  function schedule(part, start, level, output = context.destination) {
    const envelope = context.createGain();
    const peak = part.gain * level;
    const end = start + part.length;
    if (part.swell) {
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(peak, start + part.length * (part.peakAt ?? 0.45));
    } else {
      envelope.gain.setValueAtTime(peak, start);
      if (part.claps) envelope.gain.setValueAtTime(peak, end - 0.15); // the claps carry their own swell
    }
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(output);

    let source;
    if (part.tone) {
      source = context.createOscillator();
      source.type = part.tone;
      source.frequency.setValueAtTime(part.from, start);
      source.frequency.exponentialRampToValueAtTime(part.to, end);
      source.connect(envelope);
      source.start(start);
    } else if (part.claps) {
      source = context.createBufferSource();
      source.buffer = clapBuffer(part.length, part.claps);
      source.connect(filtered('bandpass', part.frequency, part.q, start)).connect(envelope);
      source.start(start);
    } else {
      source = context.createBufferSource();
      source.buffer = noise();
      source.loop = true;
      const filter = filtered(part.noise, part.frequency, part.q, start);
      if (part.sweepTo) filter.frequency.exponentialRampToValueAtTime(part.sweepTo, end);
      source.connect(filter).connect(envelope);
      source.start(start, Math.random() * 1.5); // a different stretch of noise each time
    }
    source.stop(end + 0.02);
  }

  // A recorded reaction, through the crowd bus. False when its clip is not ready.
  function playClip(file, gain) {
    const buffer = clips[file];
    if (!buffer) return false;
    const source = context.createBufferSource();
    const level = context.createGain();
    level.gain.value = gain;
    source.buffer = buffer;
    source.connect(level).connect(crowdBus());
    source.start(context.currentTime);
    return true;
  }

  // Plays a named sound now. Does nothing while sound is off or before the first gesture.
  function play(name, level = 1) {
    const voice = VOICES[name];
    if (!voice || !enabled || !context || context.state !== 'running') return false;
    const reaction = REACTIONS[name];
    if (reaction) {
      if (roundReaction && name !== roundReaction) return false;
      if (context.currentTime - (lastCrowd[name] ?? -Infinity) < CROWD_GAP) return false;
      lastCrowd[name] = context.currentTime;
      if (playClip(reaction.clip, reaction.gain)) {
        log(`${name}:clip`);
        return true;
      }
    }
    const output = reaction ? crowdBus() : context.destination;
    voice.forEach((part) => schedule(part, context.currentTime + part.at, reaction ? 1 : level, output));
    log(reaction ? `${name}:synth` : name);
    return true;
  }

  // A Test ground between balls: the recorded murmur looping once it has loaded, and until
  // then (or if it never does) low filtered noise that breathes slowly.
  function startMurmur() {
    if (murmur || !enabled || !context || document.hidden) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const envelope = context.createGain();
    const recorded = Boolean(clips[BED.clip]);
    const level = recorded ? BED.gain : MURMUR_LEVEL;
    source.loop = true;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(level, now + 1.5);
    let lfo = null;
    if (recorded) {
      source.buffer = clips[BED.clip];
      source.connect(envelope).connect(crowdBus());
    } else {
      source.buffer = noise();
      lfo = context.createOscillator();
      const depth = context.createGain();
      lfo.frequency.value = 0.13;
      depth.gain.value = MURMUR_LEVEL * 0.35;
      lfo.connect(depth).connect(envelope.gain);
      source.connect(filtered('lowpass', 520, 0.5, now)).connect(envelope).connect(crowdBus());
      lfo.start(now);
    }
    source.start(now);
    murmur = { recorded, stop: () => { source.stop(); lfo?.stop(); } };
    log(recorded ? 'murmur:clip' : 'murmur');
  }

  function stopMurmur() {
    if (!murmur) return;
    murmur.stop();
    murmur = null;
    log('murmur-stop');
  }

  button.addEventListener('click', () => {
    enabled = !enabled;
    remember(enabled);
    paint();
    if (enabled) unlock();
    else {
      stopMurmur();
      context?.suspend();
    }
  });
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopMurmur();
    else startMurmur();
  });

  connectCommentary({
    context: () => (enabled && context?.state === 'running' ? context : null),
    voiceInput,
    duckCrowd,
  });
  paint();
  return {
    button,
    play,
    history,
    isUnlocked: () => Boolean(context && context.state === 'running'),
    get murmuring() { return Boolean(murmur); },
  };
}

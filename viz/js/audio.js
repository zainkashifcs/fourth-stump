// Sound: a small Web Audio synth with no dependencies; the only recordings are
// the commentary clips (commentary.js), which play through a broadcast
// microphone chain built here. The audio context is only created or resumed
// inside a user gesture, and the choice of on or off is remembered. Besides
// the ball and bat it keeps a quiet crowd murmur going and swells a crowd
// reaction over it for each outcome; the crowd ducks under the commentator.
//
// `cuesFor`, `clapTimes` and `saturationCurve` are pure and tested under node;
// nothing at the top of this module touches the browser.
import { connectCommentary, setCommentarySound } from './commentary.js';

// Which sounds an outcome animation makes (names from outcomes.js), and when,
// in seconds from the moment the ball meets the bat or reaches the stumps.
// A cue must fall inside the delivery's tail (play.js) or it never fires.
const CUES = {
  'left-alone': [{ sound: 'whoosh', at: -0.1 }, { sound: 'glove', at: 0.4 }, { sound: 'pavilion-claps', at: 0.45 }],
  'play-and-miss': [{ sound: 'whoosh', at: -0.1 }, { sound: 'glove', at: 0.4 }, { sound: 'ooh-short', at: 0.05 }],
  middled: [{ sound: 'middled', at: 0 }, { sound: 'crisp-applause', at: 0.35 }],
  'edged-short': [{ sound: 'nick', at: 0 }, { sound: 'ooh', at: 0.08 }],
  'edged-caught': [{ sound: 'nick', at: 0 }, { sound: 'glove', at: 0.42 }, { sound: 'roar', at: 0.45 }, { sound: 'applause', at: 0.9 }],
  bowled: [{ sound: 'timber', at: 0 }, { sound: 'bails', at: 0.04 }, { sound: 'roar', at: 0.12 }, { sound: 'applause', at: 0.6 }],
};

export const cuesFor = (animationName) => CUES[animationName] ?? [];

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
  // the ball into an ash stump: a deep body that drops in pitch, a crack of wood and a thud
  timber: [
    { tone: 'sine', from: 195, to: 78, at: 0, length: 0.5, gain: 0.55 },
    { tone: 'triangle', from: 390, to: 156, at: 0, length: 0.14, gain: 0.16 },
    { noise: 'bandpass', frequency: 1100, q: 2.5, at: 0, length: 0.04, gain: 0.6 },
    { noise: 'lowpass', frequency: 380, q: 0.7, at: 0, length: 0.09, gain: 0.25 },
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
  nick: [{ noise: 'bandpass', frequency: 2400, q: 9, at: 0, length: 0.04, gain: 0.7 }],
  glove: [
    { tone: 'sine', from: 180, to: 120, at: 0, length: 0.11, gain: 0.3 },
    { noise: 'lowpass', frequency: 700, q: 0.7, at: 0, length: 0.06, gain: 0.14 },
  ],
  middled: [
    { tone: 'triangle', from: 230, to: 105, at: 0, length: 0.13, gain: 0.5 },
    { tone: 'sine', from: 96, to: 80, at: 0, length: 0.17, gain: 0.35 },
    { noise: 'bandpass', frequency: 520, q: 1.5, at: 0, length: 0.035, gain: 0.25 },
  ],
  whoosh: [{ noise: 'bandpass', frequency: 600, sweepTo: 1900, q: 1.1, at: 0, length: 0.3, gain: 0.1, swell: true }],
  // crowd reactions
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
  'ooh-short': [
    { noise: 'bandpass', frequency: 340, sweepTo: 290, q: 5, at: 0, length: 0.75, gain: 0.32, swell: true, peakAt: 0.35 },
    { noise: 'bandpass', frequency: 840, sweepTo: 720, q: 6, at: 0, length: 0.75, gain: 0.2, swell: true, peakAt: 0.35 },
  ],
};

// Three panels bowl at once in Compare venues; one crowd reaction of a kind at a time is enough.
const CROWD = new Set(['roar', 'applause', 'crisp-applause', 'pavilion-claps', 'ooh', 'ooh-short']);
const CROWD_GAP = 1; // seconds

const MURMUR_LEVEL = 0.018;

export const soundNames = Object.keys(VOICES);

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
  let murmur = null; // { source, lfo, envelope } while the crowd murmurs
  let crowd = null; // the gain every crowd sound goes through, so it can duck under the voice
  let microphone = null; // the input of the commentator's microphone chain
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

  // Runs inside a user gesture only: browsers refuse to start audio otherwise.
  function unlock() {
    if (!enabled) return;
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    if (context.state === 'suspended') context.resume();
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

  function filtered(type, frequency, q, start) {
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, start);
    return filter;
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

  // Plays a named sound now. Does nothing while sound is off or before the first gesture.
  function play(name, level = 1) {
    const voice = VOICES[name];
    if (!voice || !enabled || !context || context.state !== 'running') return false;
    if (CROWD.has(name)) {
      if (context.currentTime - (lastCrowd[name] ?? -Infinity) < CROWD_GAP) return false;
      lastCrowd[name] = context.currentTime;
    }
    const output = CROWD.has(name) ? crowdBus() : context.destination;
    voice.forEach((part) => schedule(part, context.currentTime + part.at, level, output));
    history.push(name);
    if (history.length > 40) history.shift();
    return true;
  }

  // A Test ground between balls: low, filtered noise that breathes slowly.
  function startMurmur() {
    if (murmur || !enabled || !context || document.hidden) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noise();
    source.loop = true;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(MURMUR_LEVEL, now + 1.5);
    const lfo = context.createOscillator();
    const depth = context.createGain();
    lfo.frequency.value = 0.13;
    depth.gain.value = MURMUR_LEVEL * 0.35;
    lfo.connect(depth).connect(envelope.gain);
    source.connect(filtered('lowpass', 520, 0.5, now)).connect(envelope).connect(crowdBus());
    source.start(now);
    lfo.start(now);
    murmur = { source, lfo };
    history.push('murmur');
  }

  function stopMurmur() {
    if (!murmur) return;
    murmur.source.stop();
    murmur.lfo.stop();
    murmur = null;
    history.push('murmur-stop');
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

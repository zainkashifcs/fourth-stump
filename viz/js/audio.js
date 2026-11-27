// Sound: a small Web Audio synth, no samples and no dependencies. The audio
// context is only created or resumed inside a user gesture, and the choice of
// on or off is remembered.
//
// `cuesFor` is pure and tested under node; nothing at the top of this module
// touches the browser.

// Which sounds an outcome animation makes (names from outcomes.js), and when,
// in seconds from the moment the ball meets the bat or reaches the stumps.
const CUES = {
  'left-alone': [{ sound: 'whoosh', at: -0.1 }, { sound: 'glove', at: 0.4 }],
  'play-and-miss': [{ sound: 'whoosh', at: -0.1 }, { sound: 'glove', at: 0.4 }],
  middled: [{ sound: 'middled', at: 0 }],
  'edged-short': [{ sound: 'nick', at: 0 }],
  'edged-caught': [{ sound: 'nick', at: 0 }, { sound: 'glove', at: 0.42 }],
  bowled: [{ sound: 'timber', at: 0 }, { sound: 'bails', at: 0.06 }],
};

export const cuesFor = (animationName) => CUES[animationName] ?? [];

const STORAGE_KEY = 'fourth-stump:sound';

// Each voice is a list of parts: an oscillator sweep ("tone") or filtered noise.
// Times in seconds, frequencies in hertz, `gain` the peak level.
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
  timber: [
    { tone: 'triangle', from: 140, to: 55, at: 0, length: 0.24, gain: 0.6 },
    { noise: 'bandpass', frequency: 900, q: 1.2, at: 0, length: 0.05, gain: 0.4 },
  ],
  bails: [
    { tone: 'square', from: 1400, to: 1250, at: 0, length: 0.03, gain: 0.09 },
    { tone: 'square', from: 800, to: 760, at: 0.07, length: 0.03, gain: 0.08 },
    { tone: 'square', from: 1150, to: 1050, at: 0.16, length: 0.035, gain: 0.07 },
    { tone: 'square', from: 950, to: 900, at: 0.27, length: 0.03, gain: 0.05 },
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
};

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
  const history = []; // the last sounds scheduled, for checking by hand and in the browser test

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button sound-toggle';

  function paint() {
    button.textContent = `[ SOUND: ${enabled ? 'ON' : 'OFF'} ]`;
    button.setAttribute('aria-pressed', String(enabled));
  }

  // Runs inside a user gesture only: browsers refuse to start audio otherwise.
  function unlock() {
    if (!enabled) return;
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    if (context.state === 'suspended') context.resume();
  }

  function noise() {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  function schedule(part, start, level) {
    const envelope = context.createGain();
    const peak = part.gain * level;
    const end = start + part.length;
    if (part.swell) {
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(peak, start + part.length * 0.45);
    } else {
      envelope.gain.setValueAtTime(peak, start);
    }
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(context.destination);

    let source;
    if (part.tone) {
      source = context.createOscillator();
      source.type = part.tone;
      source.frequency.setValueAtTime(part.from, start);
      source.frequency.exponentialRampToValueAtTime(part.to, end);
      source.connect(envelope);
    } else {
      source = context.createBufferSource();
      source.buffer = noise();
      const filter = context.createBiquadFilter();
      filter.type = part.noise;
      filter.Q.value = part.q;
      filter.frequency.setValueAtTime(part.frequency, start);
      if (part.sweepTo) filter.frequency.exponentialRampToValueAtTime(part.sweepTo, end);
      source.connect(filter).connect(envelope);
    }
    source.start(start);
    source.stop(end + 0.02);
  }

  // Plays a named sound now. Does nothing while sound is off or before the first gesture.
  function play(name, level = 1) {
    const voice = VOICES[name];
    if (!voice || !enabled || !context || context.state !== 'running') return false;
    voice.forEach((part) => schedule(part, context.currentTime + part.at, level));
    history.push(name);
    if (history.length > 40) history.shift();
    return true;
  }

  button.addEventListener('click', () => {
    enabled = !enabled;
    remember(enabled);
    paint();
    if (enabled) unlock();
    else context?.suspend();
  });
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);

  paint();
  return { button, play, history, isUnlocked: () => Boolean(context && context.state === 'running') };
}

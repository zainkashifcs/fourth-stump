"""Synthesise the five crowd clips in viz/assets/audio/, once, offline.

A crowd here is many people: each clip layers dozens of short vocal takes
(gasps, cheers, groans, a knowing "ahh", quiet chatter) spoken by voices that
Qwen3-TTS-12Hz-1.7B-VoiceDesign (Apache-2.0) designs from written
descriptions of ordinary spectators, cloned from nobody, plus hand claps from
individual clappers, each with a hand resonance and a rhythm of their own.
The layers are spread in time and pitch, put in a stadium with a synthetic
reverb, and written as mono Ogg Opus at 48 kHz, about 32 kbit/s.

Run from the same throwaway environment as generate_commentary.py:

    .venv/Scripts/python viz/audio/generate_crowd.py <Qwen3-TTS-12Hz-1.7B-VoiceDesign folder> [takes.npz]
"""
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel
from scipy.signal import butter, fftconvolve, sosfilt

OUT = Path(__file__).resolve().parent.parent / "assets" / "audio"
RATE = 48000
SEED = 20261127
rng = np.random.default_rng(SEED)

PEOPLE = [
    "A young man in his twenties, British accent", "A woman in her thirties, British accent",
    "An elderly man in his seventies, British accent", "A teenage boy, Australian accent",
    "A middle-aged woman, Australian accent", "A man in his forties, Australian accent",
    "A young woman in her twenties, South African accent", "A man in his fifties, South African accent",
    "A boisterous man in his thirties, British accent", "An older woman in her sixties, British accent",
    "A deep-voiced man in his forties, British accent", "A girl of about twelve, British accent",
]
COUNTS = {"gasp": 24, "cheer": 36, "ooh": 30, "ahh": 24, "praise": 10, "chat": 24}
CALLS = {
    "gasp": (["Oh!", "Ah!", "Oh!"], "letting out one sharp, sudden gasp of surprise in a packed stadium crowd."),
    "cheer": (["Yesss!", "Wahey!", "Get in!", "Yeah!", "Woooo!", "Howzat!", "Go on!"],
              "cheering wildly, shouting at the top of the voice, one face in a roaring stadium crowd."),
    "ooh": (["Ooooooooh!", "Ooooooh!", "Oooooh no!"],
            "a long, rising, groaning 'ooooh' of agony at a near miss, one voice in a stadium crowd."),
    "ahh": (["Ahhhh.", "Aaahh.", "Ahh, yes."], "a soft, knowing, approving 'ahh', relaxed, one voice among spectators."),
    "praise": (["Well played!", "Good shot.", "Shot!", "Lovely."], "calling out warm, appreciative praise from the stands."),
    "chat": (["Lovely day for it, isn't it?", "What's the score now?", "He's batting well today.",
              "Pass us the sandwiches, would you?", "I reckon they'll declare after tea.", "Did you see that one?",
              "Where did you park the car?", "That bowler's got some pace.", "Shall we get another drink?",
              "My dad brought me here when I was a boy."],
             "chatting casually and quietly to a friend in the stands between deliveries, unhurried."),
}


def generate(model):
    """Returns {kind: [samples at RATE]} of single vocal takes from every kind of spectator."""
    pool = {}
    for kind, (texts, action) in CALLS.items():
        torch.manual_seed(SEED + len(pool))
        jobs = [(texts[(i + i // len(PEOPLE)) % len(texts)], f"{PEOPLE[i % len(PEOPLE)]}, {action}") for i in range(COUNTS[kind])]
        takes = []
        for start in range(0, len(jobs), 8):
            batch = jobs[start:start + 8]
            wavs, rate = model.generate_voice_design(
                text=[t for t, _ in batch], language=["English"] * len(batch), instruct=[i for _, i in batch])
            takes += [librosa.resample(np.asarray(w, dtype=np.float32), orig_sr=rate, target_sr=RATE) for w in wavs]
        pool[kind] = [trim(t) for t in takes if np.max(np.abs(t)) > 0.01]
        print(kind, len(pool[kind]), "takes")
    return pool


def trim(samples, threshold=0.01):
    loud = np.flatnonzero(np.abs(samples) > threshold)
    return samples[max(loud[0] - 240, 0): loud[-1] + 2400] if loud.size else samples


def varied(take):
    """The same take from a slightly different throat: up to two semitones either way."""
    return librosa.resample(take, orig_sr=RATE, target_sr=int(RATE * 2 ** (rng.uniform(-2, 2) / 12)))


def place(mix, take, at, gain):
    """Adds a take at `at` seconds; a negative time starts it part-way through."""
    start = int(at * RATE)
    take = take[max(-start, 0):] / (np.max(np.abs(take)) + 1e-9)
    start = max(start, 0)
    end = min(start + len(take), len(mix))
    if end > start:
        mix[start:end] += gain * take[: end - start]


def layer(seconds, pool, count, starts, gain, fade=None):
    mix = np.zeros(int(seconds * RATE), dtype=np.float32)
    for _ in range(count):
        take = varied(pool[rng.integers(len(pool))])
        if fade:
            take = take * np.linspace(1, 0, len(take)) ** fade
        place(mix, take, rng.uniform(*starts), gain * rng.uniform(0.4, 1))
    return mix


def claps(seconds, clappers, start=(0, 0.3), rate=(3.2, 5.5), swell=0.15, decay_from=0.55, level=1.0):
    """Applause from individual clappers: each has a rhythm, a jitter and a hand resonance of their own."""
    mix = np.zeros(int(seconds * RATE), dtype=np.float32)
    for _ in range(clappers):
        sos = butter(2, sorted([rng.uniform(700, 1500), rng.uniform(1800, 3200)]), btype="band", fs=RATE, output="sos")
        period, t = 1 / rng.uniform(*rate), rng.uniform(*start)
        stop = seconds * rng.uniform(decay_from, 1.0)
        loud = rng.uniform(0.3, 1)
        while t < stop:
            n = int(rng.uniform(0.006, 0.016) * RATE)
            burst = rng.standard_normal(n) * np.exp(-np.arange(n) / (n * 0.25))
            q = t / seconds
            envelope = min(1, q / swell) * (1 if t < stop * 0.7 else (stop - t) / (stop * 0.3))
            place(mix, sosfilt(sos, burst).astype(np.float32), t, loud * envelope * level)
            t += period * rng.uniform(0.92, 1.08)
    return mix


def stadium(mix, seconds=1.6, wet=0.3):
    """A big open ground: a decaying, darkening noise tail."""
    n = int(seconds * RATE)
    tail = rng.standard_normal(n) * np.exp(-np.arange(n) / (RATE * seconds / 5))
    tail = sosfilt(butter(1, 3000, fs=RATE, output="sos"), tail)
    wet_mix = fftconvolve(mix, tail)[: len(mix)]
    wet_mix *= np.sqrt(np.mean(mix ** 2)) / (np.sqrt(np.mean(wet_mix ** 2)) + 1e-9)
    return (1 - wet) * mix + wet * wet_mix


def finish(mix, rms_db, fade_in=0.01, fade_out=0.5):
    mix = sosfilt(butter(2, 90, btype="high", fs=RATE, output="sos"), mix)
    mix[: int(fade_in * RATE)] *= np.linspace(0, 1, int(fade_in * RATE))
    if fade_out:
        mix[-int(fade_out * RATE):] *= np.linspace(1, 0, int(fade_out * RATE)) ** 2
    mix *= 10 ** (rms_db / 20) / np.sqrt(np.mean(mix ** 2))
    return np.clip(mix * min(1, 10 ** (-1.5 / 20) / np.max(np.abs(mix))), -1, 1).astype(np.float32)


def envelope(seconds, points):
    t = np.arange(int(seconds * RATE)) / RATE
    return np.interp(t, [p[0] for p in points], [p[1] for p in points]).astype(np.float32)


LONGEST = {"gasp": 1.2, "cheer": 2.5, "ooh": 3.5, "ahh": 3.0, "praise": 2.5, "chat": 4.0}  # seconds


def build(pool):
    # a take far longer than its words is the model running on; leave it out
    pool = {kind: [t for t in takes if len(t) <= LONGEST[kind] * RATE] for kind, takes in pool.items()}
    clips = {}
    # a gasp, then the roar and cheering, then applause under it
    s = 5.0
    roar = (layer(s, pool["gasp"], 18, (0, 0.1), 0.9)
            + layer(s, pool["cheer"], 60, (0.2, 2.4), 0.55)
            + layer(s, pool["cheer"], 40, (0.4, 2.8), 0.35, fade=1.5)
            + claps(s, 70, start=(0.6, 1.2), decay_from=0.7, level=0.35))
    clips["crowd_roar"] = finish(stadium(roar * envelope(s, [(0, 1), (2.6, 1), (5, 0.2)]), wet=0.35), -15)
    # a rising, collective groan
    s = 2.6
    ooh = layer(s, pool["ooh"], 40, (0, 0.18), 0.6)
    clips["crowd_oooo"] = finish(stadium(ooh, wet=0.35), -18)
    # warm applause with a few calls of praise
    s = 3.2
    applause = claps(s, 90, start=(0.1, 0.5), decay_from=0.6) + layer(s, pool["praise"], 5, (0.2, 1.2), 0.25)
    clips["crowd_applause"] = finish(stadium(applause, wet=0.25), -19)
    # a knowing "ahh" from the members and a few claps
    s = 2.6
    leave = layer(s, pool["ahh"], 22, (0, 0.25), 0.5) + claps(s, 9, start=(0.5, 0.9), rate=(2.5, 3.5), level=0.5)
    clips["crowd_leave"] = finish(stadium(leave, wet=0.3), -21)
    # the ground murmuring between balls, distant, looping with no seam
    s, overlap = 16.0, 2.0
    babble = layer(s, pool["chat"], 70, (-1.5, s), 0.5) + layer(s, pool["ahh"], 6, (0, s), 0.1)
    babble = sosfilt(butter(2, 1700, fs=RATE, output="sos"), stadium(babble, seconds=2.2, wet=0.5))
    n = int(overlap * RATE)
    fade = np.sin(np.linspace(0, np.pi / 2, n)) ** 2
    loop = babble[: len(babble) - n].copy()
    loop[:n] = loop[:n] * fade + babble[-n:] * (1 - fade)  # the tail flows into the head
    clips["crowd_bed"] = finish(loop, -24, fade_in=0, fade_out=0)
    return clips


def main(model_dir, cache=None):
    """cache: an optional .npz file that keeps the vocal takes between runs, so the mix can be redone."""
    if cache and Path(cache).exists():
        stored = np.load(cache)
        pool = {kind: [stored[k] for k in sorted(stored.files, key=lambda k: int(k.split("_")[-1])) if k.rsplit("_", 1)[0] == kind]
                for kind in CALLS}
    else:
        model = Qwen3TTSModel.from_pretrained(model_dir, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
        pool = generate(model)
        if cache:
            np.savez(cache, **{f"{kind}_{i}": take for kind, takes in pool.items() for i, take in enumerate(takes)})
    clips = build(pool)
    for name, samples in clips.items():
        path = OUT / f"{name}.ogg"
        sf.write(path, samples, RATE, format="OGG", subtype="OPUS", compression_level=0.9)  # about 32 kbit/s
        print(f"{path.name:22} {len(samples) / RATE:5.2f} s {path.stat().st_size / 1024:6.1f} KiB")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    main(*sys.argv[1:])

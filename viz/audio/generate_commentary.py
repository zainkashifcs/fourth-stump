"""Synthesise the commentary clips in viz/audio/commentary/, once, offline.

The page plays these files and needs nothing else at runtime. This script is
not one of the project's dependencies: run it from a throwaway environment.

    uv venv .venv && uv pip install --python .venv kokoro-onnx lameenc numpy
    # model files from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
    .venv/Scripts/python viz/audio/generate_commentary.py kokoro-v1.0.onnx voices-v1.0.bin

Model: Kokoro-82M (Apache-2.0), voice bm_george, British English. Each beat is
trimmed of silence, levelled to the same loudness and written as mono MP3 at
24 kHz and 48 kbit/s, a format every current browser decodes. The text of each
line must match LINES in viz/js/commentary.js; a unit test checks it.
"""
import json
import sys
from pathlib import Path

import lameenc
import numpy as np
from kokoro_onnx import Kokoro

VOICE = "bm_george"
LANG = "en-gb"
OUT = Path(__file__).resolve().parent / "commentary"

# line id -> beats, each (text spoken, text shown, synthesis speed). The first
# beat of a two-beat line is a little quicker, as a commentator's call is.
LINES = {
    "bowled": [("Bowled him!", "BOWLED HIM!", 1.08),
               ("Right through the gate, off stump out of the ground, timber everywhere!", None, 1.0)],
    "bowled-yorker": [("In the blockhole, clean bowled!", "IN THE BLOCKHOLE, CLEAN BOWLED!", 1.08),
                      ("Toe-crushing yorker right on the fourth-stump line!", None, 1.0)],
    "edged-caught": [("Edged and gone!", "EDGED AND GONE!", 1.08),
                     ("Thin feather outside off, swallowed cleanly in the slips!", None, 1.0)],
    "edged-short": [("Ooh, thick outside edge, drops agonizingly short of second slip!", None, 1.0)],
    "left-alone": [("Shouldered arms, judged to perfection on the fourth-stump line, watches it carry through.", None, 0.97)],
    "left-alone-bouncer": [("Sways out of the road, sharp bumper in the corridor, well left alone.", None, 0.97)],
    "middled": [("Right behind the line, crisp, authoritative forward defensive into the covers.", None, 0.97)],
    "play-and-miss": [("Beaten!", "BEATEN!", 1.08),
                      ("Lovely shape away off the seam, squared him up, past the outside edge.", None, 1.0)],
}

RATE = 24000
TARGET_RMS = 10 ** (-19 / 20)  # about -19 dBFS of speech
PEAK = 10 ** (-1.5 / 20)  # never above -1.5 dBFS
SILENCE = 10 ** (-45 / 20)
KEEP = int(0.015 * RATE)  # samples of room kept at each end


def trimmed(samples):
    loud = np.flatnonzero(np.abs(samples) > SILENCE)
    if loud.size == 0:
        raise ValueError("the model returned silence")
    return samples[max(loud[0] - KEEP, 0): loud[-1] + KEEP]


def levelled(samples):
    rms = float(np.sqrt(np.mean(samples ** 2)))
    gain = min(TARGET_RMS / rms, PEAK / float(np.max(np.abs(samples))))
    return samples * gain


def mp3(samples):
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(48)
    encoder.set_in_sample_rate(RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes()
    return encoder.encode(pcm) + encoder.flush()


def main(model, voices):
    kokoro = Kokoro(model, voices)
    OUT.mkdir(exist_ok=True)
    manifest = {"voice": f"Kokoro-82M {VOICE}", "format": "audio/mpeg", "lines": {}}
    for line, beats in LINES.items():
        entries = []
        for index, (spoken, shown, speed) in enumerate(beats, start=1):
            samples, rate = kokoro.create(spoken, voice=VOICE, speed=speed, lang=LANG)
            assert rate == RATE, rate
            clip = levelled(trimmed(np.asarray(samples, dtype=np.float32)))
            name = f"{line}-{index}.mp3"
            data = mp3(clip)
            (OUT / name).write_bytes(data)
            entries.append({"file": name, "text": shown or spoken, "seconds": round(len(clip) / RATE, 3), "bytes": len(data)})
            print(f"{name:28} {len(clip) / RATE:5.2f} s {len(data) / 1024:5.1f} KiB")
        manifest["lines"][line] = entries
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

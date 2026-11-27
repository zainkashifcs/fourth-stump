"""Synthesise the commentary clips in viz/assets/audio/commentary/, once, offline.

The page plays these files and needs nothing else at runtime. This script is
not one of the project's dependencies: run it from a throwaway environment
with a CUDA GPU (about 5 GB of video memory).

    uv venv .venv --python 3.12
    uv pip install --python .venv torch --index-url https://download.pytorch.org/whl/cu128
    uv pip install --python .venv qwen-tts==0.1.1 faster-whisper librosa lameenc soundfile numpy
    .venv/Scripts/python viz/audio/generate_commentary.py <Qwen3-TTS-12Hz-1.7B-VoiceDesign folder> [line ...]

Model: Qwen3-TTS-12Hz-1.7B-VoiceDesign (Apache-2.0), which designs a voice from
a written description and directs its delivery from a second one. The voice
is generic: described in words below, cloned from nobody, imitating no one.

Each line is spoken as one utterance, so the call and the clause keep the
same voice, then cut in two at the breath between them, found from the word
timings of a speech recogniser. Several takes are made per line and the one
kept is the one the recogniser understands whose pitch best fits its
style. Each beat is trimmed, levelled and written as mono MP3 at 24 kHz
and 48 kbit/s. The text of each line must match LINES in viz/js/commentary.js;
a unit test checks it.
"""
import difflib
import json
import re
import sys
from pathlib import Path

import lameenc
import librosa
import numpy as np
import torch
from faster_whisper import WhisperModel
from qwen_tts import Qwen3TTSModel

OUT = Path(__file__).resolve().parent.parent / "assets" / "audio" / "commentary"
TAKES = 4
SEED = 20261127

VOICE = ("Male, about fifty, British English accent, a rich, warm baritone that stays deep even when he raises "
         "his voice; a seasoned radio and television cricket commentator speaking close to a broadcast microphone.")
STYLES = {
    "urgent": ("He erupts with sudden, urgent, high-energy projection on the opening call, his voice lifting and "
               "ringing out over a roaring crowd, then pours out the rest at a quick, thrilled pace, still loud."),
    "alarm": ("A sudden gasp of alarm with high energy, his voice rising sharply, then rushing on breathlessly, "
              "loud and urgent, as the ball drops just short of the fielder."),
    "beaten": ("A sharp, lifted exclamation of surprise, then lively, admiring description at a brisk pace."),
    "poise": ("Warm, dry and analytical: calm and unhurried, quietly appreciative, a measured conversational pace, "
              "low and relaxed, with a hint of a smile."),
}
# the median pitch wanted, in hertz, for the first beat: a baritone raised to a shout, or at rest. Of the
# takes whose words are right, the one nearest the middle of its band is kept, so the same man is heard
# whether he is shouting or musing
PITCH = {"urgent": (150, 280), "alarm": (140, 270), "beaten": (120, 240), "poise": (85, 160)}

# line id -> (style, beats); the second beat of a two-beat line follows a breath
LINES = {
    "bowled": ("urgent", ["BOWLED HIM!", "Right through the gate, off stump out of the ground, timber everywhere!"]),
    "bowled-yorker": ("urgent", ["IN THE BLOCKHOLE, CLEAN BOWLED!", "Toe-crushing yorker right on the fourth-stump line!"]),
    "edged-caught": ("urgent", ["EDGED AND GONE!", "Thin feather outside off, swallowed cleanly in the slips!"]),
    "edged-short": ("alarm", ["Ooh, thick outside edge, drops agonizingly short of second slip!"]),
    "left-alone": ("poise", ["Shouldered arms, judged to perfection on the fourth-stump line, watches it carry through."]),
    "left-alone-bouncer": ("poise", ["Sways out of the road, sharp bumper in the corridor, well left alone."]),
    "middled": ("poise", ["Right behind the line, crisp, authoritative forward defensive into the covers."]),
    "play-and-miss": ("beaten", ["BEATEN!", "Lovely shape away off the seam, squared him up, past the outside edge."]),
}

RATE = 24000
TARGET_RMS = {"call": 10 ** (-17 / 20), "clause": 10 ** (-19 / 20)}
PEAK = 10 ** (-1.5 / 20)
SILENCE = 10 ** (-45 / 20)
KEEP = int(0.02 * RATE)
SAME = {"bold": "bowled", "agonisingly": "agonizingly"}


def letters(text):
    """The words as plain lower-case letters, with spelling variants a recogniser may use made the same."""
    return "".join(SAME.get(w, w) for w in re.sub(r"[^a-z ]", " ", text.lower()).split())


def spoken(text):
    """The words as the model reads them: no capitals, a breath between the beats."""
    return text[0] + text[1:].lower() if text.isupper() else text


def median_pitch(samples):
    f0, voiced, _ = librosa.pyin(samples, fmin=60, fmax=500, sr=RATE, frame_length=2048)
    f0 = f0[voiced & ~np.isnan(f0)]
    return float(np.median(f0)) if f0.size else float("nan")


def trimmed(samples):
    loud = np.flatnonzero(np.abs(samples) > SILENCE)
    if loud.size == 0:
        raise ValueError("silence")
    return samples[max(loud[0] - KEEP, 0): loud[-1] + KEEP]


def levelled(samples, target):
    rms = float(np.sqrt(np.mean(samples ** 2)))
    return samples * min(target / rms, PEAK / float(np.max(np.abs(samples))))


def mp3(samples):
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(48)
    encoder.set_in_sample_rate(RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    return encoder.encode((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes()) + encoder.flush()


def judge(take, beats, style, recogniser):
    """Splits a take into its beats and scores it; None when the words are wrong."""
    audio16 = librosa.resample(take, orig_sr=RATE, target_sr=16000)
    segments, _ = recogniser.transcribe(audio16, language="en", word_timestamps=True, beam_size=5)
    heard = [w for s in segments for w in s.words]
    expected = "".join(letters(beat) for beat in beats)
    if difflib.SequenceMatcher(None, "".join(letters(w.word) for w in heard), expected).ratio() < 0.92:
        return None
    pieces = [take]
    if len(beats) > 1:
        # the last word of the call: where the letters heard so far reach the call's length
        call, count, n = len(letters(beats[0])), 0, 0
        while n < len(heard) - 1 and count + len(letters(heard[n].word)) <= call + 2:
            count += len(letters(heard[n].word))
            n += 1
        if n == 0 or n >= len(heard):
            return None
        # the quietest 20 ms around the breath the recogniser found, whose word timings are rough
        frame = int(0.02 * RATE)
        lo = max(int((heard[n - 1].end - 0.05) * RATE), frame)
        hi = min(int((heard[n].start + 0.03) * RATE), len(take) - frame)
        energy = [float(np.sum(take[i:i + frame] ** 2)) for i in range(lo, max(hi, lo + 1), frame // 4)]
        cut = lo + int(np.argmin(energy)) * (frame // 4) + frame // 2
        pieces = [take[:cut], take[cut:]]
    # each beat on its own must still say its words, or the cut is in the wrong place
    understood = []
    for beat, piece in zip(beats, pieces):
        alone, _ = recogniser.transcribe(librosa.resample(piece, orig_sr=RATE, target_sr=16000), language="en", beam_size=5)
        said = letters(" ".join(x.text for x in alone))
        if beat is not beats[0] and not said.startswith(letters(beat)[:3]):
            return None  # the clause lost its first word to the call
        understood.append(difflib.SequenceMatcher(None, said, letters(beat)).ratio())
    if min(understood) < 0.75:
        return None
    pitches = [median_pitch(p) for p in pieces]
    if any(np.isnan(pitches)):
        return None  # a beat with no voiced sound in it
    low, high = PITCH[style]
    outside = max(np.log2(low / pitches[0]), np.log2(pitches[0] / high), 0)  # octaves out of the band
    flat = len(pieces) > 1 and not pitches[0] > pitches[1] * 0.98  # the call should be lifted above the clause
    score = 10 * outside + (5 if flat else 0) + 10 * (1 - min(understood)) + abs(np.log(pitches[0] / (low * high) ** 0.5))
    return {"pieces": pieces, "pitches": pitches, "score": score, "fits": outside == 0 and not flat}


def main(model_dir, *only):
    """only: line ids to remake, keeping the others from the existing manifest."""
    model = Qwen3TTSModel.from_pretrained(model_dir, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    recogniser = WhisperModel("small.en", device="cpu", compute_type="int8")
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"model": "Qwen3-TTS-12Hz-1.7B-VoiceDesign", "voice": VOICE, "styles": STYLES, "format": "audio/mpeg", "lines": {}}
    if only:
        manifest["lines"] = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))["lines"]
    for line, (style, beats) in LINES.items():
        if only and line not in only:
            continue
        text = " ... ".join(spoken(beat) for beat in beats)
        judged = []
        for attempt in range(5):  # a batch of takes, and more until one fits its style
            torch.manual_seed(SEED + attempt)
            takes, rate = model.generate_voice_design(
                text=[text] * TAKES, language=["English"] * TAKES, instruct=[f"{VOICE} {STYLES[style]}"] * TAKES)
            assert rate == RATE, rate
            judged += [j for j in (judge(np.asarray(t, dtype=np.float32), beats, style, recogniser) for t in takes) if j]
            if any(j["fits"] for j in judged):
                break
        if not judged:
            sys.exit(f"{line}: no take had the right words; change the style or add takes")
        best = min(judged, key=lambda j: j["score"])
        entries = []
        for index, (beat, piece) in enumerate(zip(beats, best["pieces"]), start=1):
            role = "call" if len(beats) > 1 and index == 1 else "clause"
            clip = levelled(trimmed(piece), TARGET_RMS[role])
            name = f"{line}-{index}.mp3"
            data = mp3(clip)
            (OUT / name).write_bytes(data)
            entries.append({"file": name, "text": beat, "style": style, "seconds": round(len(clip) / RATE, 3),
                            "pitch_hz": round(best["pitches"][index - 1], 1), "in_style": bool(best["fits"]), "bytes": len(data)})
            print(f"{name:26} {len(clip) / RATE:5.2f} s  {best['pitches'][index - 1]:6.1f} Hz  {len(data) / 1024:5.1f} KiB")
        manifest["lines"][line] = entries
    manifest["lines"] = {line: manifest["lines"][line] for line in LINES}  # in the order of LINES
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(*sys.argv[1:])

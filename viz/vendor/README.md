# Vendored files

Nothing here is edited. The page loads these through the import map in `index.html` and `css/style.css`, so it needs no network at runtime.

| Folder | Package | Version | Licence | Files taken |
|---|---|---|---|---|
| `three-0.170.0/` | `three` (npm) | 0.170.0 | MIT (`LICENSE`) | `build/three.module.min.js`; from `examples/jsm`: `controls/OrbitControls.js`, `lines/{Line2,LineGeometry,LineMaterial,LineSegments2,LineSegmentsGeometry}.js`, `loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js` |
| `vt323-5.3.0/` | `@fontsource/vt323` (npm) | 5.3.0 | OFL-1.1 (`LICENSE`) | `files/vt323-latin-400-normal.woff2` |

Animation uses Three.js only: each model's clips sit on a `THREE.AnimationMixer` (`js/models/rig.js`) posed from the page's own clock (`js/play.js`), and skinned models are copied with `SkeletonUtils.clone`. GSAP is not vendored.

## Audio

The ball, bat, stumps and gloves are synthesised with the Web Audio API (`js/audio.js`). The commentary and the crowd are recorded clips in `../assets/audio/`, made once, offline, by the scripts in `../audio/` (not dependencies of the page or the project; each script's header says how to run it). Nothing in them comes from a recording of a real person: every voice was designed from a written description, with no reference audio, no cloning and no imitation of any named commentator.

| Item | Source | Licence |
|---|---|---|
| Speech model | [Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign), revision `5ecdb67327fd37bb2e042aab12ff7391903235d3`, run with `qwen-tts` 0.1.1 | Apache-2.0 (model card and repository). The licence puts no condition on audio the model generates, so the clips may be redistributed and used commercially |
| Commentary voice | Designed, not cloned: "Male, about fifty, British English accent, a rich, warm baritone that stays deep even when he raises his voice; a seasoned radio and television cricket commentator speaking close to a broadcast microphone." Delivery per line from one of four style prompts (urgent, alarm, beaten, poise), all written out in `../audio/generate_commentary.py` and in `commentary/manifest.json` | as the model |
| Crowd voices | Designed spectators ("A young man in his twenties, British accent", "A middle-aged woman, Australian accent", ...), each giving one short gasp, cheer, groan, "ahh", call of praise or line of chatter, layered by `../audio/generate_crowd.py` with synthetic hand claps and a synthetic reverb | as the model |
| Tools used to make them, not shipped | `torch` 2.11 (BSD-3-Clause), `qwen-tts` 0.1.1 (Apache-2.0), `faster-whisper` 1.2.1 with Whisper `small.en` (MIT; used only to check the words and find the breath between beats), `librosa` 1.0.1 (ISC), `scipy` (BSD-3-Clause), `soundfile` 0.14.0 with libsndfile 1.2.2 (BSD-3-Clause, LGPL-2.1), `lameenc` 1.9.0 (LGPL-3.0 or later) | as stated |

Formats:

- Commentary: `commentary/<line>-<beat>.mp3`, one file per beat, with `commentary/manifest.json` giving each beat's words, style, length, median pitch and size. MPEG Layer III, mono, 24 kHz, 48 kbit/s: every current browser decodes it with `decodeAudioData`. If a clip does not load or decode, the page says the same words with the browser's speech synthesis instead.
- Crowd: `crowd_roar.ogg`, `crowd_oooo.ogg`, `crowd_applause.ogg`, `crowd_leave.ogg` and `crowd_bed.ogg` (14 s, cross-faded into itself so it loops without a seam). Ogg Opus, mono, 48 kHz, about 32 kbit/s, which Chrome and Firefox have decoded for many years and Safari since 18.4 (macOS 15.4, iOS 18.4). Where a crowd clip does not load or decode (an older Safari, say), the page plays the synthesised crowd of earlier versions instead.

To upgrade: `npm pack three@<version>`, copy the same files into a new versioned folder, and change the import map.

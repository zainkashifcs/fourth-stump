# Vendored files

Nothing here is edited. The page loads these through the import map in `index.html` and `css/style.css`, so it needs no network at runtime.

| Folder | Package | Version | Licence | Files taken |
|---|---|---|---|---|
| `three-0.170.0/` | `three` (npm) | 0.170.0 | MIT (`LICENSE`) | `build/three.module.min.js`; from `examples/jsm`: `controls/OrbitControls.js`, `lines/{Line2,LineGeometry,LineMaterial,LineSegments2,LineSegmentsGeometry}.js`, `loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js` |
| `vt323-5.3.0/` | `@fontsource/vt323` (npm) | 5.3.0 | OFL-1.1 (`LICENSE`) | `files/vt323-latin-400-normal.woff2` |

Animation uses Three.js only: each model's clips sit on a `THREE.AnimationMixer` (`js/models/rig.js`) posed from the page's own clock (`js/play.js`), and skinned models are copied with `SkeletonUtils.clone`. GSAP is not vendored. Sound effects and the crowd are synthesised with the Web Audio API (`js/audio.js`), with no samples or libraries.

The commentary (`js/commentary.js`) plays recorded clips from `../audio/commentary/`: twelve mono MP3 files, one per beat of each line, named `<line>-<beat>.mp3`, with `manifest.json` listing their words, lengths and sizes. They were synthesised once, offline, by `../audio/generate_commentary.py`, which is not a dependency of the page or the project and can rebuild them:

| Item | Source | Licence |
|---|---|---|
| Speech model | Kokoro-82M, ONNX export `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the `model-files-v1.0` release of [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (original weights [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)) | Apache-2.0 (model and voice packs); the output audio may be redistributed |
| Voice | `bm_george`, British English male, a stock voice of the model that imitates no real speaker | Apache-2.0, part of the model's voice pack |
| Tools used to make them, not shipped | `kokoro-onnx` 0.6.1 (MIT); its phonemiser, `phonemizer` 3.6.0 over `espeak-ng` from `espeakng-loader` 0.2.4 (GPL-3.0 or later, run at build time only: no code of theirs is in the clips or the page); `lameenc` 1.9.0 (LGPL-3.0 or later, the LAME MP3 encoder) | as stated |

Format: MPEG-1/2 Layer III, 24 kHz, 48 kbit/s CBR, decoded by every current browser through `decodeAudioData`. If a clip does not load or decode, the page says the same words with the browser's speech synthesis instead.

To upgrade: `npm pack three@<version>`, copy the same files into a new versioned folder, and change the import map.

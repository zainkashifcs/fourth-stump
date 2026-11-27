# Vendored files

Nothing here is edited. The page loads these through the import map in `index.html` and `css/style.css`, so it needs no network at runtime.

| Folder | Package | Version | Licence | Files taken |
|---|---|---|---|---|
| `three-0.170.0/` | `three` (npm) | 0.170.0 | MIT (`LICENSE`) | `build/three.module.min.js`; from `examples/jsm`: `controls/OrbitControls.js`, `lines/{Line2,LineGeometry,LineMaterial,LineSegments2,LineSegmentsGeometry}.js`, `loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js` |
| `vt323-5.3.0/` | `@fontsource/vt323` (npm) | 5.3.0 | OFL-1.1 (`LICENSE`) | `files/vt323-latin-400-normal.woff2` |

Animation uses Three.js only: each model's clips sit on a `THREE.AnimationMixer` (`js/models/rig.js`) posed from the page's own clock (`js/play.js`), and skinned models are copied with `SkeletonUtils.clone`. GSAP is not vendored. Sound is synthesised with the Web Audio API (`js/audio.js`), and the commentary is spoken with the browser's speech synthesis (`js/commentary.js`), with no samples or libraries.

To upgrade: `npm pack three@<version>`, copy the same files into a new versioned folder, and change the import map.

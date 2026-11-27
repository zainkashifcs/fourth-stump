# Vendored files

Nothing here is edited. The page loads these through the import map in `index.html` and `css/style.css`, so it needs no network at runtime.

| Folder | Package | Version | Licence | Files taken |
|---|---|---|---|---|
| `three-0.170.0/` | `three` (npm) | 0.170.0 | MIT (`LICENSE`) | `build/three.module.min.js`; from `examples/jsm`: `controls/OrbitControls.js`, `lines/{Line2,LineGeometry,LineMaterial,LineSegments2,LineSegmentsGeometry}.js`, `loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js` |
| `vt323-5.3.0/` | `@fontsource/vt323` (npm) | 5.3.0 | OFL-1.1 (`LICENSE`) | `files/vt323-latin-400-normal.woff2` |

Animation uses plain Three.js driven by the page's own clock (`js/play.js`); GSAP is not vendored.

To upgrade: `npm pack three@<version>`, copy the same files into a new versioned folder, and change the import map.

# Vendored files

Nothing here is edited. The page loads these through the import map in `index.html`, so it needs no network at runtime.

| Folder | Package | Version | Licence | Files taken |
|---|---|---|---|---|
| `three-0.170.0/` | `three` (npm) | 0.170.0 | MIT (`LICENSE`) | `build/three.module.min.js`; from `examples/jsm`: `controls/OrbitControls.js`, `lines/{Line2,LineGeometry,LineMaterial,LineSegments2,LineSegmentsGeometry}.js` |
| `besley-5.3.0/` | `@fontsource-variable/besley` (npm) | 5.3.0 | OFL-1.1 (`LICENSE`) | `files/besley-latin-wght-normal.woff2` |

To upgrade: `npm pack three@<version>`, copy the same files into a new versioned folder, and change the import map.

# Precomputed Three.js visualisation behind a frozen engine header

The visualisation is a static Three.js page with procedural meshes that reads trajectories precomputed by the engine (venue × ball age × bowler arm × bowling end, plus a set of game deliveries). It never runs the engine in the browser. Plotly was rejected because it cannot carry the "Test Your Eye" game; a WebAssembly engine was rejected for this cycle because Emscripten is not installed and the grid of precomputed cases is small.

## Consequences

- The trajectory file's schema is the only contract between the engine and the visualisation.

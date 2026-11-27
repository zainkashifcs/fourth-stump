# Precomputed Three.js visualisation behind a frozen engine header

The visualisation is a static Three.js page with procedural meshes that reads trajectories precomputed by the engine (venue × ball age × bowler arm × bowling end, plus a set of game deliveries). It never runs the engine in the browser. Plotly was rejected because it cannot carry the "Test Your Eye" game; a WebAssembly engine was rejected for this cycle because Emscripten is not installed and the grid of precomputed cases is small.

## Consequences

- The trajectory file's schema is the only contract between the engine and the visualisation.

## Amendment, 2026-11-27: models built in Blender

The procedural meshes are replaced by flat-shaded low-poly models (batter, bowler, slip and one backdrop per venue) built by Python scripts run in headless Blender 5.3 and exported as glTF to `viz/assets/`. The scripts in `viz/blender/` are the source; the `.glb` files are committed so the page needs no build step. If a model fails to load, the page draws a procedural placeholder and keeps working.

- Each figure is one mesh on an armature, rigidly skinned (one bone per part), with pixel-art textures painted by the scripts and sampled unfiltered. Poses are written as joint angles; clips are sampled from them at 30 frames a second and baked, and the page plays them with an animation mixer.
- The clips carry the times the page needs as custom properties: when the ball leaves the bowler's hand, when the front foot lands, when the bat meets the ball. The page lines these up with the engine's release and arrival times.
- The flight up to the bat is still the engine's trajectory. What the ball, bat and stumps do after contact is illustration, chosen by the delivery's simulated outcome.

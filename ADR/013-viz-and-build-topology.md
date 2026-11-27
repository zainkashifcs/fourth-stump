# Precomputed Three.js visualisation behind a frozen engine header

The visualisation is a static Three.js page with procedural meshes that reads trajectories precomputed by the engine (venue × ball age × bowler arm × bowling end, plus a set of game deliveries). It never runs the engine in the browser. Plotly was rejected because it cannot carry the "Test Your Eye" game; a WebAssembly engine was rejected for this cycle because Emscripten is not installed and the grid of precomputed cases is small.

## Consequences

- The trajectory file's schema is the only contract between the engine and the visualisation.

## Amendment, 2026-11-27: models built in Blender

The procedural meshes are replaced by flat-shaded low-poly models (batter, bowler, slip and one backdrop per venue) built by Python scripts run in headless Blender 5.3 and exported as glTF to `viz/assets/`. The scripts in `viz/blender/` are the source; the `.glb` files are committed so the page needs no build step. If a model fails to load, the page draws a procedural placeholder and keeps working.

- Each figure is one mesh on an armature, rigidly skinned (one bone per part), with pixel-art textures painted by the scripts and sampled unfiltered. Poses are written as joint angles; clips are sampled from them at 30 frames a second and baked, and the page plays them with an animation mixer.
- The clips carry the times the page needs as custom properties: when the ball leaves the bowler's hand, when the front foot lands, when the bat meets the ball. The page lines these up with the engine's release and arrival times.
- The flight up to the bat is still the engine's trajectory. What the ball, bat and stumps do after contact is illustration, chosen by the delivery's simulated outcome.

## Amendment, 2026-11-27: the batter's place, the cameras and the ground

- The right-hander stands 0.48 m to the leg side of middle stump, and his head, body, legs and pads never come inside x = -0.15. The model exports its bat line and body edge, and its build asserts both; the page places the batter from those numbers, moving him across to meet a ball he plays and further to leg to let one go that would otherwise hit him.
- A delivery that is left or missed is drawn on past the stumps to the keeper's plane by extrapolating its last segment under gravity. That stretch is not simulated.
- With the run-up shown, the director's last cut lands on the camera the visitor has chosen.
- The stadium, the crowd sound and the spoken commentary are illustration. They carry no model output.

## Amendment, 2026-11-27: the bat on the ball, the keeper and the outcome clips

- A played ball is met where it is. In the last 0.14 s the bat's face (middled) or outside edge (edged) is steered onto the ball's position at the instant it reaches the bat, by one pure solve in `viz/js/contact.js`: the contact point may slide within the blade's middle third, the whole body shifts across and along the pitch within the body rule and bends at the knees, the bat swings about the top hand clear of the head, and both arms are re-solved onto the handle every frame. Where no believable pose reaches the ball, the solve stops as close as it can and reports the shortfall; a play-and-miss ends with the edge 8 cm inside the ball's line. The ball's flight is not changed to meet the bat.
- The wicketkeeper stands on the keeper's plane and takes a ball that goes through at the instant the drawn path reaches him, which is also when the glove sound plays. He is not drawn from the behind-the-stumps camera: 1.4 m behind the wicket he would hide the batter, the stumps and the ball's path, which that camera exists to show. Moving the camera instead would have changed every framing the page is tested against.
- Each outcome has its own batter clips, mapped in `viz/js/outcomes.js` by name, and a missing clip falls back to the one before it. A dismissal's look back starts when the stumps break.

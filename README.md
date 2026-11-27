# Fourth Stump EV

A deterministic, zero-allocation C++20 Monte Carlo engine that simulates 31 million cricket deliveries per second, with a closed-form trajectory kernel checked against an RK4 reference to a measured error bound of 8 mm.

It answers one question. A fast bowler lands the ball just outside off stump, in the "fourth-stump corridor". Should the batter leave it or play it? The answer depends on the ground: the same release swings at Lord's, bounces over the stumps at the WACA in Perth and seams at Newlands.

![The same release at Lord's, the WACA and Newlands](viz/screenshots/comparison.png)

## Headline numbers

| Claim | Measured | How it is checked |
|---|---|---|
| Throughput | 30.8 million deliveries per second on 16 threads, 3.1 million on one (no wind); 19.3 million and 1.9 million with wind | `make bench` |
| Kernel error against RK4 | worst case 5.3 mm over the whole envelope, 1.5 mm at typical swing; published bound 8 mm | `make error-bound`, plus a random search in the tests |
| Kernel speed | 17 times faster than RK4 at equal accuracy (168 times faster than RK4 at a 1 ms step) | `make bench` |
| Deterministic | bit-identical output on 1, 4 and 16 threads from one binary | C++ and Python tests |
| Zero allocation | no call to `operator new` inside `simulate_batch` | a test that replaces global `operator new` |

Machine: Intel Core i5-13450HX (10 cores, 16 threads), Windows 11, g++ 16.2 (MSYS2 UCRT64).
Flags: `-std=c++20 -O3 -march=native -ffp-contract=off -fopenmp`. No `-ffast-math`.
`-march=native` means these figures belong to this machine.

Each delivery in the throughput figure is the full pipeline: three normal draws, two flight legs, the bounce, the batter's expected arrival, and the outcome of both leaving and playing.

## The decision

For each action the engine estimates

```
EV(action) = E[runs | action] − λ(w, a) · P(dismissal | action)
```

where `λ(w, a)` is the wicket cost in runs with `w` wickets lost and a ball `a` overs old. Leave and play are evaluated on the same simulated delivery with the same random draws (common random numbers).

## The kernel

Quadratic drag has no exact closed-form solution in three dimensions, so the kernel uses the flat-trajectory approximation: a delivery is nearly straight, so distance down the pitch replaces time as the independent variable.

In the frame moving with the wind, write `u` for forward air speed, `d` for distance travelled, `θx = ux/u` and `θz = uz/u` for the path's slopes, `k = ρ A C_d / 2m` for drag and `k_s = ρ A C_s / 2m` for the seam side force.

**Speed decays exponentially with distance.** Drag gives `du/dt = −k u²`, and `dd = u dt`, so

$$\frac{du}{dd} = -k\,u \quad\Rightarrow\quad u(d) = u_0\,e^{-kd}, \qquad t(d) = \frac{e^{kd}-1}{k\,u_0}$$

**Swing is parabolic in distance.** The slope changes at

$$\frac{d\theta_x}{dd} = \frac{a_x u - u_x a_s}{u^3} = k_s$$

The drag terms cancel exactly, and the side force `k_s u²` divided by `u²` leaves a constant. Drag and the side force both scale with `v²`, so however much the ball slows, it turns by the same angle per metre:

$$x(d) = x_0 + \theta_{x0}\,d + \tfrac{1}{2}k_s\,d^2$$

This is why a ball swings "late": the sideways movement grows with the square of distance. It is also why swing at a given distance does not depend on pace, which a test checks on the RK4 reference at 120 and 150 km/h.

**Gravity has a closed form with one `exp`.** `dθz/dd = −g/u² = −g e^{2kd}/u₀²`, so

$$z(d) = z_0 + \theta_{z0}\,d - \frac{g\,(e^{2kd} - 1 - 2kd)}{4k^2u_0^2}$$

The kernel adds second-order corrections (means of products of the path's slopes over a leg) that cost no extra transcendental call. They took the worst error from about 24 mm to 5 mm. Wind along the pitch makes the arrival distance the root of a Lambert-W-type equation, solved with two fixed Newton steps, which is why the windy throughput is lower.

### Measured error bound

The reference trajectory integrates the full equations of motion (gravity, quadratic drag, seam side force, wind) with RK4. The kernel and the reference share one bounce map, so the comparison is end to end.

| Swing coefficient | Wind (m/s) | Deliveries | Worst error at the bat (mm) | Worst error at the stumps (mm) |
|---|---|---|---|---|
| 0.00 | 0 | 2,880 | 0.57 | 0.62 |
| 0.00 | 5 | 23,040 | 0.86 | 0.92 |
| 0.10 | 0 | 5,760 | 0.86 | 0.97 |
| 0.10 | 5 | 46,080 | 1.39 | 1.51 |
| 0.20 | 0 | 5,760 | 1.51 | 1.79 |
| 0.20 | 5 | 46,080 | 2.59 | 3.01 |
| 0.30 | 0 | 5,760 | 2.49 | 3.07 |
| 0.30 | 5 | 46,080 | 4.49 | 5.30 |

The envelope the bound is claimed for: 120 to 150 km/h; swing coefficient up to 0.30 either way; wind up to 5 m/s from any direction; release up to 1.0 m either side of the stumps and 1.9 to 2.4 m high; any length from a full toss to 10 m; line from 0.2 m down leg to 0.6 m outside off. A swing coefficient of 0.30 moves the ball about 77 cm over the pitch, far more than a real delivery. Outside the envelope the kernel promises nothing.

The published bound of 8 mm sits above the measured 5.3 mm to leave room for points the grid and the random search did not hit.

### Speed against RK4

One thread, the same 4,000 deliveries, with wind. "Worst error" is against RK4 at a 0.01 ms step.

| Trajectory method | ns per delivery | Worst error (mm) | Kernel speed-up |
|---|---|---|---|
| Closed-form kernel | 220 | 0.403 | 1x |
| RK4, 20 ms step | 1,871 | 0.551 | 9x |
| RK4, 10 ms step | 3,735 | 0.137 | 17x |
| RK4, 5 ms step | 7,422 | 0.035 | 34x |
| RK4, 1 ms step | 36,916 | 0.001 | 168x |

The honest comparison is the 10 ms row: the coarsest RK4 step that is at least as accurate as the kernel on these deliveries. The larger figures compare against an RK4 that is far more accurate than the kernel.

### Throughput

| Conditions | Batch size | Threads | Median ns per delivery | Million deliveries per second |
|---|---|---|---|---|
| No wind | 4,096 | 1 | 328.8 | 3.0 |
| No wind | 4,096 | 16 | 78.3 | 12.8 |
| No wind | 65,536 | 1 | 331.1 | 3.0 |
| No wind | 65,536 | 16 | 39.5 | 25.3 |
| No wind | 1,048,576 | 1 | 325.4 | 3.1 |
| No wind | 1,048,576 | 16 | 33.7 | 29.7 |
| No wind | 4,194,304 | 1 | 326.6 | 3.1 |
| No wind | 4,194,304 | 16 | 32.5 | 30.8 |
| Wind (4, 1) m/s | 1,048,576 | 1 | 538.6 | 1.9 |
| Wind (4, 1) m/s | 1,048,576 | 16 | 51.9 | 19.3 |

## Engineering choices

- **Determinism.** Each delivery's xoshiro256\*\* stream is a function of the seed and the delivery's index only, never of a thread. Per-delivery streams are required, not just convenient: Ziggurat sampling rejects, so deliveries consume a varying number of draws. Results are written by index and totals are integer counts. The promise is bit-reproducible across thread counts on one binary, and statistically reproducible across platforms, because the platform `exp` can differ in the last bit.
- **Zero allocation.** The caller owns 64-byte-aligned structure-of-arrays buffers; the engine writes into them. The test sees `operator new` only: it cannot see `malloc` calls inside the OpenMP runtime, so it warms the runtime up first and runs at a fixed thread count.
- **Common random numbers.** Measured in the tests: comparing two nearby conditions on the same seed cuts the variance of the difference by about 30 times against independent seeds. Comparing leave with play on the same deliveries cuts it by about 1.3 times.
- **Header-only.** The engine is one header with no dependencies. OpenMP is optional at compile time.

## The model

- **Forces.** Gravity, quadratic drag, and a seam side force `½ ρ A C_s v²` perpendicular to the ball's air-relative velocity. There is no Magnus term: seam-bowling swing comes from the seam tripping the airflow on one side of the ball, not from spin.
- **Bounce.** The ball reflects about the pitch's surface normal, keeps a fraction `e_z` of its speed into the pitch and 0.887 of its speed along it, then turns sideways by a random seam deviation. `e_z` varies a little from one delivery to the next (variable bounce), so a delivery that usually clears the bails sometimes keeps low. At Lord's the normal is tilted by the slope: a 2.5 m fall across the ground, about 1.1°, which moves the ball three to six centimetres sideways by the stumps, depending on length (4.3 cm at a good length).
- **The batter.** The batter tracks the true path until 0.2 s before the ball arrives, then commits the bat to where a delivery with mean swing and no seam deviation would arrive. Only movement after that commit point can beat the bat.
- **Outcomes.** If played: a small gap is middled and scores; a gap near the bat's edge is an edge, which is a dismissal if it is an outside edge that carries to the slip cordon and is caught; a large gap is a play-and-miss, which is a dismissal if the ball goes on to hit the stumps. If left: a dismissal only if it hits the stumps.

Out of scope by decision: spin bowling, LBW, catches off middled deliveries, run-outs, and a second bounce.

## Data and calibration

Ball-by-ball data for 905 men's Tests (1.74 million deliveries, 2001 to 2026) comes from [Cricsheet](https://cricsheet.org/), made available under the [Open Data Commons Attribution License (ODC-By 1.0)](http://opendatacommons.org/licenses/by/1.0/). The files under `data/` are derived from it. Cricsheet has no line, length, batter action or bowler type, so nothing here depends on observing them; overs 1 to 25 of each innings stand in for pace bowling.

**Wicket cost.** `V(w, a)` is the expected runs for the rest of the innings with `w` wickets lost and a ball `a` overs old. Ball age cycles every 80 overs, so `V` is the fixed point of a cyclic recursion, solved exactly as a linear system. `V(0, 1)` is 315 runs. The wicket cost `λ = V(w, a) − V(w+1, a)` runs from about 44 runs with no wickets lost to about 14 with nine. "Overs remaining" was rejected as a state: with nothing after the close of play, a wicket near stumps would cost nothing, which is the opposite of Test cricket.

**Calibration.** Historical dismissal rates are seen only on deliveries a batter chose to play. The calibrator simulates a batter who follows a leave rule and matches two rates per venue on that population: the bowled rate identifies the spread of seam deviation, and the caught rate identifies catch conversion (the share of carrying edges that are caught).

| Venue | New-ball deliveries | Seam deviation spread | Catch conversion | Mean restitution `e_z` (assumed) |
|---|---|---|---|---|
| Lord's | 23,715 | 0.42° (0.40° to 0.44°) | 0.73 (0.61 to 0.86) | 0.52 |
| The WACA, Perth (13 Tests at the WACA, 6 at Perth Stadium) | 10,949 | 0.50° (0.45° to 0.54°) | 0.18 (0.14 to 0.24) | 0.62 |
| Newlands | 14,785 | 0.41° (0.38° to 0.44°) | 0.47 (0.39 to 0.59) | 0.56 |

Intervals are 95% bootstrap intervals for sampling noise in the counts only.

What the calibration does and does not show:

- On synthetic data the calibrator recovers the seam deviation spread within 10% in 9 of 9 fits and catch conversion in 8 of 9 (the ninth is 10.3% high). A fit that ignores the leave rule understates catch conversion by 30% to 50%.
- The data does not separate the venues' seam deviation.
- Restitution and swing spread could not be identified from two rates and are fixed at assumed values. The fitted values are conditional on them: a restitution prior wrong by 0.05 moves catch conversion by about a factor of two.
- Perth's catch conversion of 0.18 is not credible as a physical number. It says the assumed restitution of 0.62, with a slip cordon at a fixed distance, produces more carrying edges than the scorebook supports. An earlier fit that let restitution vary put it near 0.50 at all three venues; that fit is kept in `data/calibrated.json`.
- The caught target is all catches, an upper bound on cordon catches. Counting only catches by the wicketkeeper gives catch conversions about 2.5 times smaller.
- The fitted values are effective values for this outcome model, not measurements of the pitches.

## The visualisation

A static Three.js page styled as a retro Test-match broadcast, reading trajectories precomputed by the engine. The models are in the style of a late-1990s console game: a few hundred triangles each, unfiltered pixel-art textures, and rigid skinning with one bone per body part. A batter, a bowler, a slip, a ring fielder at cover, the stumps, the ground's stands, rope and boards, the Lord's Pavilion, the WACA scoreboard, and Table Mountain with Devil's Peak are built, painted, rigged and animated by the Python scripts in `viz/blender/` and exported as glTF to `viz/assets/`. The page plays their baked clips (run-up, bound and delivery, appeal, forward defensive, leave, edge, the fielders' crouch, the stumps flying) in time with the engine's release and arrival times. The stands leave the view behind the bowler open for each ground's backdrop, and the boards carry that ground's name.

The batter stands outside leg stump so a corridor delivery never passes through him: his head, body and pads stay at least 15 cm to the leg side of middle stump, he moves across to meet the ball when he plays, and when he leaves one that would hit him on the leg side he steps further to leg.

```
cd viz && python -m http.server 8000     # then open http://localhost:8000/
```

- **Compare venues.** The same release at the three grounds, with a ball-age slider, a bowler-arm toggle and a bowling-end toggle. "Bowl again" bowls one sampled delivery per ground and plays its outcome: middled, edged, bowled, left alone or play-and-miss. From the Pavilion End at Lord's the slope takes the ball into a right-hander; from the Nursery End, away.
- **Test your eye.** The bowler runs in through three camera cuts (behind his mark, side-on at the crease, then the batter's view), and the picture freezes at the bounce. Choose leave or play, then see the true path, the outcome and the expected value of both actions.
- **Cameras.** Behind the stumps, side on, or from above (a high camera in the stand behind the batter that takes in the whole pitch, the cover fielder and the far stands). With the run-up on, the director's third cut lands on the chosen camera; behind the stumps it closes in on the bat or the stumps when the ball gets there, and holds the wide frame for a ball left alone or missed so its path runs on to the keeper.
- **Around it.** A teletext boot screen that tracks the real loading (skip it with any key, or `?noboot=1`), sound synthesised with the Web Audio API (no audio files): ball, bat and stumps, a crowd murmur between balls and a crowd reaction to each outcome. A commentator's line for each outcome appears as a caption and, with sound on, is spoken once by the browser's speech synthesis. There is also a "How it works" panel.

![Side on, with the stands, the boards and the cover fielder](viz/screenshots/sideon.png)

![Test Your Eye](viz/screenshots/game.png)

![Bowled](viz/screenshots/bowled.png)

![Boot screen](viz/screenshots/boot.png)

The flight up to the bat is the engine's trajectory. What the ball, bat and stumps do after contact is illustration, not simulation. The ball is drawn larger than life.

```
"<path to>/blender" --background --python viz/blender/build_all.py     # rebuild the models (Blender 5.3; also runs inside an open Blender)
```

## Build and test

Requires g++ with C++20 and OpenMP, [uv](https://docs.astral.sh/uv/), and `make` (on Windows, `mingw32-make` from Git Bash or an MSYS2 shell).

```
uv sync            # Python environment
make test          # C++ tests, then the Python tests against the freshly built binding
make bench         # throughput and the RK4 comparison
make error-bound   # the error-bound table
make viz-data      # regenerate viz/data/trajectories.json
uv run python -m scraper                 # download and parse Cricsheet (cached)
uv run python -m calibrator.run_expectancy
uv run python -m calibrator.calibrate    # about 20 minutes
```

Tests: 25 C++ test cases (Catch2), 53 Python tests (pytest and hypothesis, including a property-based search of the envelope against the reference), and 11 for the page's logic. All run offline.

| Path | Contents |
|---|---|
| `cpp/include/fourth_stump_engine.hpp` | The whole engine |
| `cpp/include/fourth_stump_reference.hpp` | The RK4 reference trajectory |
| `cpp/include/fourth_stump_envelope.hpp` | The envelope and the sweep that measures the bound |
| `cpp/tests`, `cpp/bench` | Tests, benchmark, error-bound tool |
| `fourth_stump/` | Python binding and venue conditions |
| `scraper/`, `calibrator/` | Cricsheet pipeline, run expectancy, calibration |
| `viz/` | The page |
| `ADR/`, `GLOSSARY.md` | Thirteen design decisions and the project's vocabulary |

## Constants and sources

| Constant | Value | Source |
|---|---|---|
| Pace retention at the bounce | 0.887 | James, Carré and Haake (2004), "The playing performance of county cricket pitches", Sports Engineering 7(1), 1–14, [doi:10.1007/BF02843969](https://doi.org/10.1007/BF02843969): 87.1% to 90.2% of impact speed retained |
| Restitution range | 0.46 to 0.65 | The same paper: rebound angle 52% to 73% of impact angle, times pace retention |
| Batter reaction time | 0.2 s | McLeod (1987), "Visual reaction time and high-speed ball games", Perception 16(1), 49–59, [doi:10.1068/p160049](https://doi.org/10.1068/p160049) |
| Lord's slope | 2.5 m fall, 1.09° | [Lord's slope](https://en.wikipedia.org/wiki/Lord%27s_slope); ground width 143 yd from the MCC drawing reported at [cricketboundary.com](https://cricketboundary.com/grounds/lords/) |
| Bat width | 108 mm | Laws of Cricket, Law 5 |

The paper figures were read from abstract and index pages, not the full texts. The slope angle assumes the fall runs straight across the pitch; it runs diagonally, so 1.09° is an upper estimate.

## Assumptions that are not fitted

- Each venue's mean swing coefficient, how fast swing fades with ball age (a Dukes ball is given a longer half-life than a Kookaburra), and each venue's wind.
- Each venue's mean restitution and swing spread (see above), and how much restitution varies between deliveries (a standard deviation of 0.025 to 0.035).
- The leave rule: leave when the expected arrival is more than 0.30 m outside off stump.
- The population of releases used for calibration: right-arm over the wicket to a right-hander.
- The slip cordon's distance (13 m), the pace an edge keeps, and the width of the edge band on the bat.
- A new ball every 80 overs; declarations, the follow-on and the match situation are ignored in the wicket cost.
- "The WACA, Perth" pools 13 Tests at the WACA with 6 at Perth Stadium.

## Third-party code

[Catch2](https://github.com/catchorg/Catch2) 3.7.1 (BSL-1.0), [pybind11](https://github.com/pybind/pybind11) (BSD), [Three.js](https://threejs.org/) 0.170.0 (MIT) and the VT323 typeface (OFL), each vendored or installed with its licence. The 3D models are this project's own, built with [Blender](https://www.blender.org/).

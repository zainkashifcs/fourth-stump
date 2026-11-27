# trajectories.json

Written by `make viz-data` (`fourth_stump/export_viz.py`). It is the contract between the engine and the visualisation's precomputed views (ADR-013). The live panel runs the engine in the browser instead and reads `live.json`, below (ADR-016).

Units are metres, seconds and runs. Axes: origin at the base of the batter's middle stump, `+x` is the off side of a right-hander, `+y` points up the pitch towards the bowler, `+z` is up. A delivery travels from large `y` to `y = 0`.

## Top level

| Key | Type | Meaning |
|---|---|---|
| `meta` | object | `generated` (date), `constants` (pitch and stump geometry, bat plane, corridor limits), `wicket_cost_source` (`"run-expectancy table"` or `"placeholder"`), `wickets_lost`, `runs_middled`, `deliveries_per_estimate` |
| `venues` | object | Keyed by `lords`, `perth`, `newlands`. Each has `name`, `ball`, and `ends` (two names; index is the `end` used elsewhere) |
| `ball_ages` | number[] | The ball ages (overs) that scenarios exist for |
| `arms` | string[] | `"right"`, `"left"`: bowler arm, over the wicket to a right-hander |
| `scenarios` | object[] | One per venue × ball age × arm × end |
| `game` | object[] | Deliveries for the "Test Your Eye" game |

## Scenario

The same release at every venue, under that venue's conditions: right-arm over from `x = +0.75`, `z = 2.08` (left-arm over is its mirror), 135 km/h, good length, aimed to pass middle stump without swing or wind.

| Key | Meaning |
|---|---|
| `venue`, `ball_age`, `arm`, `end` | Which case this is |
| `path` | `[x, y, z]` points of the mean delivery (mean swing, no seam deviation), release first, stumps last |
| `bounce_index` | Index into `path` of the bounce point, or `-1` if it did not bounce |
| `fan` | Ten sampled deliveries (random swing, seam deviation and bounce height) as `[x, y, z]` paths, to show the spread |
| `fan_bounce_index` | For each `fan` path, the index of its bounce point, or `-1` |
| `fan_outcomes` | For each `fan` path, `{leave, play}`: what happens to that delivery under each action, using the same names as `outcome_leave` and `outcome_play` below |
| `p_wicket_leave`, `p_wicket_play` | Probability of dismissal for each action |
| `p_middled`, `p_edged`, `p_missed` | Outcome probabilities when played; they sum to 1 |
| `wicket_cost` | Wicket cost (lambda) used, in runs |
| `ev_leave`, `ev_play` | Expected value of each action, in runs |
| `best` | `"leave"` or `"play"`: the action with the higher expected value |

## Game delivery

One actual delivery with random swing and seam deviation.

| Key | Meaning |
|---|---|
| `id`, `venue`, `ball_age`, `arm`, `end` | Which case this is |
| `path`, `bounce_index` | As for a scenario, but the actual path. Everything after `bounce_index` is what the game hides |
| `outcome_leave` | `"safe"` or `"bowled"`: what happens to this delivery if left |
| `outcome_play` | `"middled"`, `"edged_safe"`, `"edged_caught"`, `"missed"` or `"missed_bowled"`: what happens if played |
| `p_*`, `wicket_cost`, `ev_leave`, `ev_play`, `best` | As for a scenario, computed over what the batter can know at the bounce: this delivery's swing, with its seam deviation and bounce height still random |

# live.json

Written by the same command. It holds what the page's live WebAssembly engine (ADR-016) needs besides the visitor's own settings, and is passed through `viz/js/engine-wasm.js` unchanged: `engine.run({ conditions: venues[v].conditions, release: release[arm], length, ... })`. Units and axes as above; angles in radians.

| Key | Meaning |
|---|---|
| `meta` | `generated` (date), `ball_age` and `bowling_end`: the ball age (overs) and end (index into the venue's `ends` in trajectories.json) that the venue conditions, swing, crosswind and wicket costs describe; `wicket_cost_source` as in trajectories.json |
| `release.right`, `release.left` | The showcase release of the scenarios, without its speed and length: `x`, `z` (release position: right-arm over at `x = +0.75`, `z = 2.08`; left-arm over is its mirror) and `line` (the `x` at which a path through the bounce with no swing and no wind would pass the stumps). The engine aims it at the chosen speed and length exactly as the exporter does |
| `lengths` | `good`, `yorker`, `bouncer`: the engine's `DeliveryLength` targets, each `{bounce_y, from_release}`: the aimed bounce distance from the batter's stumps (negative is behind them: the yorker reaches the stumps on the full) and from the release plane. `good` is the scenarios' length |
| `venues` | Keyed by `lords`, `perth`, `newlands` |
| `venues.*.name` | Display name |
| `venues.*.conditions` | Every engine `Conditions` field except the swing mean and `wind_x`, which the visitor sets: `sigma_swing`, `sigma_seam`, `e_z`, `sigma_ez`, `pace_retention`, `tilt`, `wind_y`, `release_y`, `reaction_time` |
| `venues.*.swing` | `{right, left}`: the venue's mean swing coefficient for that arm at `meta.ball_age`, a default for the swing control |
| `venues.*.crosswind` | The venue's `wind_x` at `meta.bowling_end`, in m/s, a default for the crosswind control |
| `venues.*.max_crosswind` | The largest crosswind magnitude the envelope allows with this venue's `wind_y` (the envelope bounds wind speed, not each component); beyond it the engine throws |
| `venues.*.catch_conversion` | Share of carrying edges that are caught |
| `venues.*.runs_middled` | Expected runs from a middled delivery |
| `wicket_cost` | `ball_age`, and `by_wickets_lost`: ten wicket costs in runs, for 0 to 9 wickets lost, at that ball age. The scenarios use index `meta.wickets_lost` of trajectories.json |

With `meta.ball_age`, `meta.bowling_end`, the matching arm's release and swing, the good length, the venue's crosswind, 135 km/h and `by_wickets_lost[3]`, a run reproduces that scenario in trajectories.json within Monte Carlo error (`viz/tests/engine-wasm.test.mjs`).

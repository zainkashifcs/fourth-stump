# trajectories.json

Written by `make viz-data` (`fourth_stump/export_viz.py`). It is the only contract between the engine and the visualisation (ADR-013): the page reads this file and never runs the engine.

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

The same release at every venue, under that venue's conditions.

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

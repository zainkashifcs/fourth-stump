# Selection-aware simulated calibration, validated on synthetic data first

Historical dismissal rates are observed only on deliveries the batter chose to play, so fitting the physics as if every delivery were played is biased. The calibrator simulates a batter who follows a fixed leave rule and matches historical rates per venue on that policy-following population. Because a few venue-level rates cannot identify many parameters, the calibrator must recover known parameters from synthetic data before any real-data fit is reported, and it fits only what recovers.

## What is fitted, as built

Two historical rates per venue carry information about the physics: bowled per ball and caught per ball. They identify two parameters:

- **Seam deviation spread** (`sigma_seam`), from the bowled rate alone. A delivery is bowled mostly by beating the bat and going on to the stumps, which needs a large gap.
- **Catch conversion**, from the caught rate, in closed form: the historical caught rate divided by the simulated rate of edges that carry.

Vertical restitution (`e_z`) and swing spread (`sigma_swing`) are fixed at the venue priors. Runs for a middled delivery are set so simulated runs per ball equal history (ADR-009), so runs per ball is not a free rate.

## How this differs from the plan

The plan was Nelder-Mead over `sigma_swing`, `sigma_seam` and `e_z` against three rates. Two things changed it.

1. On synthetic data `sigma_swing` did not recover (1 fit in 12), so it was fixed, as this decision required.
2. Fitting `sigma_seam` and `e_z` recovered well on synthetic data but gave a result we do not ship on real data. In the outcome model as first written, every carrying edge was a dismissal, so restitution was the only lever on the catch rate. The fit put `e_z` near 0.50 at all three venues whatever their priors (first at the 0.46 floor, before inside edges were excluded from cordon catches). That erases the difference in bounce between venues. Catch conversion was added to the outcome model (ADR-007) so that the catch rate has its own parameter. The two-parameter fit is kept in `data/calibrated.json` for comparison.

## Consequences

- Common random numbers: the seeds are fixed across evaluations, so each simulated rate is a deterministic function of the parameters and the bowled rate can be solved by a one-dimensional root find.
- A fit that ignores the leave rule leaves `sigma_seam` almost unchanged (left deliveries are rarely bowled) but understates catch conversion by 30% to 50%, because it counts edges the batter never offered. A test asserts the bias.
- The fitted values are conditional on the `e_z` priors, which are assumptions inside the literature range (ADR-006), not measurements of these pitches. On synthetic data a prior wrong by 0.05 moves catch conversion by roughly a factor of two. Perth's fitted catch conversion (0.17) is low enough to say that its prior of 0.62, combined with a cordon at a fixed distance, produces more carrying edges than the scorebook supports.
- The data does not separate the venues' seam deviation: the fitted spreads are 0.41° to 0.51° with overlapping or near-overlapping intervals.
- The caught target is all catches, an upper bound on cordon catches. A lower bound from catches by the innings' wicketkeeper gives catch conversions about 2.5 times smaller. Both are reported.
- The distribution of releases and the leave rule's threshold (0.30 m outside off stump) are stated assumptions. Neither can be fitted without line and action data (ADR-009).
- Real-data fits are reported with bootstrap intervals that cover sampling noise in the counts only, and are presented as the reason the engine matters, not as a research result (ADR-001).

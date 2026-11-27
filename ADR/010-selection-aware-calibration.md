# Selection-aware simulated calibration, validated on synthetic data first

Historical dismissal rates are observed only on deliveries the batter chose to play, so fitting the physics as if every delivery were played is biased. The calibrator simulates a batter who follows a fixed leave rule and matches three historical rates per venue (bowled, caught, runs per ball) on that policy-following population, using Nelder-Mead over `sigma_swing`, `sigma_seam` and `e_z`. Because three parameters against three noisy venue-level rates is thin, the calibrator must first recover known parameters from synthetic data before any real-data fit is reported.

## Consequences

- The objective uses common random numbers: the seed is fixed across optimiser iterations, so the objective is a deterministic function of the parameters.
- The first tests generate data from known parameters and check that the calibrator recovers them, and that a naive fit ignoring leaves does not.
- If `e_z` does not recover on synthetic data it is fixed from the literature range (ADR-006) and the README says so.
- The distribution of releases and the leave rule's threshold are stated assumptions. Neither can be fitted without line and action data (ADR-009).
- Real-data fits are reported with bootstrap intervals and presented as the reason the engine matters, not as a research result (ADR-001).

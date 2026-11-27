"""The first parameterisation, rejected, kept so that its result can be reproduced.

It fitted `sigma_seam` and `e_z` to the bowled and caught rates with every carrying edge
caught. Restitution was then the only lever on the catch rate, and the fit drove it to the
bottom of its range at every venue. The shipped fit is in calibrate.py.
"""
import itertools
import math

import numpy as np
from scipy.optimize import minimize

from .population import Batch, bootstrap_targets, percentile_intervals, simulate_rates, size

FITTED = ("sigma_seam", "e_z")
# e_z is the literature range of ADR-006; the sigma_seam range is a wide bracket around the priors.
BOUNDS = {"sigma_seam": (0.0005, 0.03), "e_z": (0.46, 0.65)}
TARGET_RATES = ("bowled", "caught")
GRID_POINTS = 7  # per parameter, for the coarse search that picks the starting point
MAX_RESTARTS = 4
MATCHED_LOSS = 1e-4  # both rates within about 1% of their targets
REASON = ("Not shipped: with every carrying edge caught, restitution is the only lever on the catch rate, so the fit "
          "puts e_z near 0.50 at all three venues whatever their priors. That erases the difference in bounce between the venues, which the data cannot confirm or deny on two rates.")


def _unit(name: str, value: float) -> float:
    """Position of a value in its search range: logarithmic for sigma_seam, linear for e_z."""
    lo, hi = BOUNDS[name]
    return (value - lo) / (hi - lo) if name == "e_z" else math.log(value / lo) / math.log(hi / lo)


def _from_unit(name: str, u: float) -> float:
    lo, hi = BOUNDS[name]
    u = float(np.clip(u, 0.0, 1.0))
    return lo + u * (hi - lo) if name == "e_z" else lo * (hi / lo) ** u


def fit_two_parameters(population: tuple[Batch, ...], target: dict, fixed: dict, start: dict | None = None,
                       step: float = 0.1) -> dict:
    """Match the bowled and caught rates over sigma_seam and e_z, taking every carrying edge as caught.

    The loss is the sum of squared log ratios of simulated to target rate. Without a `start` the
    search begins from the best point of a coarse grid, because Nelder-Mead alone stalls wherever
    no simulated delivery is bowled.
    """
    # A simulated rate of zero counts as half an event, so its log is finite and far worse than any near miss.
    floor = 0.5 / size(population)

    def rates_at(u) -> dict:
        rates = simulate_rates(population, {**fixed, **{name: _from_unit(name, x) for name, x in zip(FITTED, u)}})
        return {**rates, "caught": rates["carried"]}

    def loss(u) -> float:
        rates = rates_at(u)
        return sum(math.log(max(rates[k], floor) / target[k]) ** 2 for k in TARGET_RATES)

    if start is None:
        best_u = np.array(min(itertools.product(np.linspace(0.0, 1.0, GRID_POINTS), repeat=len(FITTED)), key=loss))
    else:
        best_u = np.array([_unit(name, start[name]) for name in FITTED])
    best_loss = math.inf
    # A simplex clipped at a bound can collapse onto it, so the search restarts from where it stopped,
    # with a fresh simplex, until a restart no longer helps or the rates are matched.
    for _ in range(MAX_RESTARTS):
        # Step each vertex towards the middle of the range so the simplex starts inside the bounds.
        simplex = np.vstack([best_u, *(best_u + np.where(best_u < 0.5, step, -step) * axis for axis in np.eye(len(FITTED)))])
        result = minimize(loss, best_u, method="Nelder-Mead", bounds=[(0.0, 1.0)] * len(FITTED),
                          options={"initial_simplex": simplex, "xatol": 1e-3, "fatol": 1e-7, "maxfev": 600})
        improved = best_loss - result.fun
        if result.fun < best_loss:
            best_u, best_loss = np.clip(result.x, 0.0, 1.0), float(result.fun)
        if best_loss < MATCHED_LOSS or improved < MATCHED_LOSS:
            break
    params = {**fixed, **{name: _from_unit(name, x) for name, x in zip(FITTED, best_u)}}
    return {"params": params, "loss": best_loss, "simulated": {k: rates_at(best_u)[k] for k in TARGET_RATES}}


def rejected_fit(population: tuple[Batch, ...], target: dict, balls: int, fixed: dict, bootstrap: int) -> dict:
    """The two-parameter fit of one venue with bootstrap intervals, in the shape data/calibrated.json records."""
    best = fit_two_parameters(population, target, fixed)
    params = best["params"]
    resampled = [fit_two_parameters(population, t, fixed, start=params, step=0.03)["params"]
                 for t in bootstrap_targets(balls, target, bootstrap)]
    return {"why_rejected": REASON, **{name: round(params[name], 6) for name in FITTED},
            "intervals": percentile_intervals(resampled, FITTED) if resampled else {},
            "simulated": best["simulated"], "loss": best["loss"]}

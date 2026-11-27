"""Selection-aware simulated calibration of each venue's seam deviation and catch conversion (ADR-010).

The simulated batter follows the leave rule, so historical rates are matched on the population
they were observed on. `e_z` and `sigma_swing` are fixed at the venue priors. The bowled rate
does not depend on catch conversion, so `sigma_seam` is found from the bowled rate alone, and
catch conversion follows in closed form: the historical caught rate over the simulated rate of
edges that carry. `uv run python -m calibrator.calibrate` fits the venues to
data/calibration_moments.json, runs the synthetic study and writes data/calibrated.json.
"""
import argparse
import json
import math

import numpy as np
from scipy.optimize import brentq

from .population import (DATA, LEAVE_THRESHOLD, BALL_AGES, Batch, bootstrap_targets, false_shot_share, make_population,
                         percentile_intervals, simulate_rates, size, venue_priors)
from .two_parameter_fit import rejected_fit

PARAMETERS = ("sigma_swing", "sigma_seam", "e_z", "catch_conversion")
FITTED = ("sigma_seam", "catch_conversion")
FIXED = ("sigma_swing", "e_z")
SEAM_RANGE = (0.0005, 0.03)  # a wide bracket around the priors
E_Z_RANGE = (0.46, 0.65)  # the literature range of ADR-006
# The cordon catch rate is only bracketed by the data (ADR-009): all catches above, wicketkeeper catches below.
CAUGHT_UPPER, CAUGHT_LOWER = "caught_per_ball", "caught_keeper_per_ball"
TOLERANCE = 0.10  # relative error that still counts as recovered in the synthetic study


def fit(population: tuple[Batch, ...], target: dict, fixed: dict, leave_threshold: float | None = LEAVE_THRESHOLD) -> dict:
    """`sigma_seam` from the target bowled rate, then catch conversion from the target caught rate.

    `fixed` holds `sigma_swing` and `e_z`. Catch conversion is clamped to 1 and a parameter that
    ends on a bound is listed in `at_bound`: there the target was not matched.
    """
    # A simulated rate of zero counts as half an event, so its log is finite.
    floor = 0.5 / size(population)

    def rates_at(log_seam: float) -> dict:
        return simulate_rates(population, {**fixed, "sigma_seam": math.exp(log_seam)}, leave_threshold)

    def bowled_miss(log_seam: float) -> float:
        return math.log(max(rates_at(log_seam)["bowled"], floor) / target["bowled"])

    low, high = (math.log(edge) for edge in SEAM_RANGE)
    if bowled_miss(low) >= 0.0:
        log_seam = low
    elif bowled_miss(high) <= 0.0:
        log_seam = high
    else:
        log_seam = brentq(bowled_miss, low, high, xtol=1e-4)
    rates = rates_at(log_seam)
    unclamped = target["caught"] / rates["carried"] if rates["carried"] > 0.0 else math.inf
    conversion = min(unclamped, 1.0)
    at_bound = [name for name, hit in (("sigma_seam", log_seam in (low, high)), ("catch_conversion", unclamped > 1.0)) if hit]
    return {
        "params": {**fixed, "sigma_seam": math.exp(log_seam), "catch_conversion": conversion},
        "at_bound": at_bound,
        "simulated": {"bowled": rates["bowled"], "caught": conversion * rates["carried"], "edged_carried": rates["carried"],
                      "middled": rates["middled"], "left": rates["left"],
                      "false_shot_share_of_played": false_shot_share(rates)},
    }


def _target_from(population: tuple[Batch, ...], truth: dict) -> dict:
    rates = simulate_rates(population, truth)
    return {"bowled": rates["bowled"], "caught": truth["catch_conversion"] * rates["carried"]}


def _relative_errors(estimate: dict, truth: dict) -> dict:
    return {name: estimate[name] / truth[name] - 1.0 for name in FITTED}


def _clip_e_z(value: float) -> float:
    return round(min(max(value, E_Z_RANGE[0]), E_Z_RANGE[1]), 4)


# What the fit holds fixed in each case of the synthetic study, as a function of the truth.
STUDY_CASES = {
    "exact": lambda t: {},
    "sigma_swing 50% too low": lambda t: {"sigma_swing": 0.5 * t["sigma_swing"]},
    "sigma_swing 50% too high": lambda t: {"sigma_swing": 1.5 * t["sigma_swing"]},
    "e_z 0.05 too low": lambda t: {"e_z": _clip_e_z(t["e_z"] - 0.05)},
    "e_z 0.05 too high": lambda t: {"e_z": _clip_e_z(t["e_z"] + 0.05)},
}
IGNORING_LEAVES = "exact, ignoring the leave rule"
# (sigma_seam, catch_conversion) pairs the study generates rates from; sigma_swing and e_z are the venue priors.
STUDY_TRUTHS = ((0.007, 0.30), (0.009, 0.08), (0.012, 0.60))  # the first two are close to the real fits


def synthetic_study(venue: str, truths: tuple[tuple[float, float], ...] = STUDY_TRUTHS, deliveries: int = 200_000) -> list[dict]:
    """Generate rates from known parameters, then see what the fit gets back under each study case.

    The "history" is simulated on its own releases and seed, so recovery is not an artefact of
    reusing the fitting population's random draws.
    """
    history = make_population(venue, deliveries, seed=777)
    population = make_population(venue, deliveries)
    prior = venue_priors()[venue]
    rows = []
    for sigma_seam, conversion in truths:
        truth = {"sigma_swing": prior["sigma_swing"], "e_z": prior["e_z"], "sigma_seam": sigma_seam, "catch_conversion": conversion}
        target = _target_from(history, truth)
        cases = [(name, {**{k: truth[k] for k in FIXED}, **held(truth)}, LEAVE_THRESHOLD) for name, held in STUDY_CASES.items()]
        cases.append((IGNORING_LEAVES, {k: truth[k] for k in FIXED}, None))
        for name, fixed, leave_threshold in cases:
            result = fit(population, target, fixed, leave_threshold)
            errors = _relative_errors(result["params"], truth)
            rows.append({"case": name, "truth": truth, "held": fixed, "target": target,
                         "estimate": {k: result["params"][k] for k in FITTED}, "at_bound": result["at_bound"],
                         "relative_error": errors, "recovered": {k: abs(e) <= TOLERANCE for k, e in errors.items()}})
    return rows


def study_summary(study: dict) -> dict:
    """Per study case, over every venue and truth: the range of relative error of each fitted parameter."""
    rows = [row for venue_rows in study.values() for row in venue_rows]
    summary = {}
    for case in dict.fromkeys(row["case"] for row in rows):
        of_case = [row for row in rows if row["case"] == case]
        summary[case] = {
            "fits": len(of_case),
            "recovered": {k: sum(row["recovered"][k] for row in of_case) for k in FITTED},
            "relative_error_range": {k: [min(row["relative_error"][k] for row in of_case),
                                         max(row["relative_error"][k] for row in of_case)] for k in FITTED},
        }
    return summary


def calibrate_venue(venue: str, moments: dict, prior: dict, bootstrap: int, deliveries: int = 200_000) -> dict:
    """Fit one venue to its historical rates, with bootstrap intervals and the catch-conversion range."""
    population = make_population(venue, deliveries)
    fixed = {name: prior[name] for name in FIXED}
    target = {"bowled": moments["bowled_per_ball"], "caught": moments[CAUGHT_UPPER]}
    best = fit(population, target, fixed)
    params, simulated = best["params"], best["simulated"]
    resampled = [fit(population, t, fixed)["params"] for t in bootstrap_targets(moments["balls"], target, bootstrap)]
    # The bowled target is the same, so the lower bound changes only the closed-form step.
    keeper = min(moments[CAUGHT_LOWER] / simulated["edged_carried"], 1.0)
    return {
        **{name: round(params[name], 6) for name in PARAMETERS},
        "fitted": list(FITTED),
        "fixed": list(FIXED),
        "at_bound": best["at_bound"],
        "intervals": percentile_intervals(resampled, FITTED) if resampled else {},
        "target": {**target, "caught_is": "all catches (upper bound on cordon catches)",
                   "runs_per_ball": moments["runs_per_ball"], "balls": moments["balls"]},
        "simulated": {**simulated, "runs_per_ball": moments["runs_per_ball"]},
        "runs_middled": moments["runs_per_ball"] / simulated["middled"],
        "catch_conversion_range": {
            "wicketkeeper_catches_only": round(keeper, 6), "all_catches": round(params["catch_conversion"], 6),
            "target_caught": {"wicketkeeper_catches_only": moments[CAUGHT_LOWER], "all_catches": moments[CAUGHT_UPPER]}},
        "rejected_two_parameter_fit": rejected_fit(population, target, moments["balls"], prior, bootstrap),
    }


def _percent_range(summary: dict, case: str, name: str) -> str:
    low, high = summary[case]["relative_error_range"][name]
    return f"{low:+.0%} to {high:+.0%}"


def _study_notes(summary: dict) -> list[str]:
    exact = summary["exact"]
    return [
        f"Synthetic study, {exact['fits']} fits with sigma_swing and e_z held at the truth: sigma_seam came back "
        f"within {TOLERANCE:.0%} in {exact['recovered']['sigma_seam']} and catch conversion in "
        f"{exact['recovered']['catch_conversion']}; errors {_percent_range(summary, 'exact', 'sigma_seam')} and "
        f"{_percent_range(summary, 'exact', 'catch_conversion')}.",
        "Synthetic study, e_z held 0.05 from the truth (less where that would leave the 0.46 to 0.65 range): too low "
        f"moves sigma_seam {_percent_range(summary, 'e_z 0.05 too low', 'sigma_seam')} and catch conversion "
        f"{_percent_range(summary, 'e_z 0.05 too low', 'catch_conversion')}; too high moves them "
        f"{_percent_range(summary, 'e_z 0.05 too high', 'sigma_seam')} and "
        f"{_percent_range(summary, 'e_z 0.05 too high', 'catch_conversion')}. A catch conversion clamped at 1 "
        "understates the first range. The fitted values are conditional on the e_z priors, which are assumptions.",
        "Synthetic study, sigma_swing held 50% from the truth: too low moves sigma_seam "
        f"{_percent_range(summary, 'sigma_swing 50% too low', 'sigma_seam')} and catch conversion "
        f"{_percent_range(summary, 'sigma_swing 50% too low', 'catch_conversion')}; too high moves them "
        f"{_percent_range(summary, 'sigma_swing 50% too high', 'sigma_seam')} and "
        f"{_percent_range(summary, 'sigma_swing 50% too high', 'catch_conversion')}.",
        "Synthetic study, the exact fit ignoring the leave rule (every delivery played): sigma_seam moves "
        f"{_percent_range(summary, IGNORING_LEAVES, 'sigma_seam')} and catch conversion "
        f"{_percent_range(summary, IGNORING_LEAVES, 'catch_conversion')}. Left deliveries are almost never bowled, "
        "so the bowled rate and sigma_seam barely change. Playing them adds edges that the batter never offered, "
        "so the simulated rate of carrying edges is too high and catch conversion comes back too low.",
    ]


def notes(venues: dict, bootstrap: int, summary: dict) -> list[str]:
    conversions = ", ".join(
        f"{v['catch_conversion_range']['wicketkeeper_catches_only']:.3f} to {v['catch_conversion']:.3f} at {key}"
        for key, v in venues.items())
    found = [
        "Fitted: sigma_seam from the historical bowled rate, then catch conversion as the historical caught rate "
        "over the simulated rate of edges that carry. Fixed at the priors in data/venues.json: e_z (assumptions "
        "inside the literature range 0.46 to 0.65, ADR-006) and sigma_swing. Two rates cannot identify more than "
        "two parameters.",
        f"Catch conversion range, wicketkeeper catches only to all catches: {conversions}. The shipped value is the "
        "upper end, because all catches are an upper bound on cordon catches; the lower end counts only catches by "
        "the innings' wicketkeeper, identified by the stumping proxy in data/calibration_moments.json. sigma_seam "
        "is the same at both ends, because the bowled target is.",
        "Fitted values are effective values for this outcome model, not measurements. Catch conversion absorbs "
        "everything between an edge that the model says carries and a catch in the scorebook: edges that fly wide "
        "of the cordon or fall between catchers, drops, and any excess of edges in the model itself.",
        *_study_notes(summary),
        "runs_middled is not fitted. Per venue it is historical batter runs per legal ball divided by the simulated "
        "share of deliveries that are played and middled, so simulated runs per ball equal history by construction. "
        "The top-level runs_middled is the mean across venues.",
        f"Leave rule: the batter leaves when the expected arrival at the bat is more than {LEAVE_THRESHOLD} m "
        "outside off stump. The threshold is an assumption that cannot be fitted without line and action data "
        "(ADR-010); each venue's simulated.left is the share of deliveries left under it, and "
        "simulated.false_shot_share_of_played is the share of played deliveries edged or missed.",
        "Simulated population: right-arm over the wicket to a right-hander with the engine's default ReleaseSpec, "
        f"ball ages {', '.join(map(str, BALL_AGES))} and both bowling ends in equal parts, 200,000 deliveries per "
        "evaluation, fixed seeds (common random numbers). Left-armers, left-handers and spin are not simulated.",
        "Historical rates are per legal ball in overs 1 to 25 of men's Tests, all bowlers and batters. Dismissals "
        "outside the model (ADR-007) are not wickets for these rates but their balls count.",
        f"Intervals are 95% percentile intervals over {bootstrap} bootstrap resamples of each venue's ball outcomes "
        "(bowled, caught or neither). They cover sampling noise in the historical counts only: balls are treated "
        "as independent, and e_z, sigma_swing, the leave rule, the release population and the choice of catch "
        "target are held fixed.",
        "rejected_two_parameter_fit is the first parameterisation (sigma_seam and e_z fitted, every carrying edge "
        "caught), kept for the record with the reason it was rejected.",
    ]
    clamped = [key for key, v in venues.items() if v["at_bound"]]
    if clamped:
        found.append(f"At a bound, so the target there was not matched: {', '.join(clamped)} (see each venue's at_bound).")
    return found


def calibrate(bootstrap: int = 200) -> dict:
    moments = json.loads((DATA / "calibration_moments.json").read_text(encoding="utf-8"))["venues"]
    priors = venue_priors()
    venues = {venue: calibrate_venue(venue, moments[venue], priors[venue], bootstrap) for venue in priors}
    study = {venue: synthetic_study(venue) for venue in priors}
    summary = study_summary(study)
    return {
        "venues": venues,
        "runs_middled": float(np.mean([v["runs_middled"] for v in venues.values()])),
        "leave_threshold": LEAVE_THRESHOLD,
        "notes": notes(venues, bootstrap, summary),
        "synthetic_study": {"summary": summary, "fits": study},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bootstrap", type=int, default=200, help="resamples of the historical counts per venue")
    args = parser.parse_args()
    result = calibrate(args.bootstrap)
    path = DATA / "calibrated.json"
    path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {path}")
    for venue, v in result["venues"].items():
        print(venue, {name: v[name] for name in PARAMETERS}, v["intervals"], v["at_bound"])
    print(json.dumps(result["synthetic_study"]["summary"], indent=1))


if __name__ == "__main__":
    main()

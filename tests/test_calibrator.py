"""The selection-aware calibrator: synthetic recovery, the bias of ignoring leaves, and the committed fit."""
import json

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from calibrator.calibrate import FITTED, FIXED, IGNORING_LEAVES, STUDY_CASES, calibrate_venue, fit, synthetic_study
from calibrator.population import DATA, bootstrap_targets, make_population, simulate_rates, venue_priors
from calibrator.two_parameter_fit import fit_two_parameters

TRUTH = {"sigma_swing": 0.05, "sigma_seam": 0.008, "e_z": 0.52, "catch_conversion": 0.30}
HELD = {name: TRUTH[name] for name in FIXED}
DELIVERIES = 100_000


@pytest.fixture(scope="module")
def population():
    return make_population("lords", DELIVERIES)


@pytest.fixture(scope="module")
def history():
    """Rates generated from TRUTH on releases and random draws the fit never sees."""
    return simulate_rates(make_population("lords", DELIVERIES, seed=777), TRUTH)


@pytest.fixture(scope="module")
def synthetic_target(history):
    return {"bowled": history["bowled"], "caught": TRUTH["catch_conversion"] * history["carried"]}


@pytest.fixture(scope="module")
def small_population():
    return make_population("newlands", 10_000)


def test_the_calibrator_recovers_every_parameter_it_fits(population, synthetic_target):
    result = fit(population, synthetic_target, HELD)
    for name in FITTED:
        assert result["params"][name] == pytest.approx(TRUTH[name], rel=0.10), name
    assert result["at_bound"] == []
    assert {name: result["params"][name] for name in FIXED} == HELD  # not fitted, so left where they were fixed
    assert result["simulated"]["bowled"] == pytest.approx(synthetic_target["bowled"], rel=0.02)
    assert result["simulated"]["caught"] == pytest.approx(synthetic_target["caught"])


def test_a_fit_that_ignores_the_leave_rule_is_biased(population, synthetic_target):
    aware = fit(population, synthetic_target, HELD)
    naive = fit(population, synthetic_target, HELD, leave_threshold=None)["params"]
    # Playing every delivery adds carrying edges the batter never offered, so fewer of them can have been caught.
    assert naive["catch_conversion"] < 0.85 * TRUTH["catch_conversion"]
    assert naive["catch_conversion"] < 0.85 * aware["params"]["catch_conversion"]
    assert naive["sigma_seam"] == pytest.approx(aware["params"]["sigma_seam"], rel=0.02)  # left balls are not bowled


def test_catch_conversion_is_clamped_at_one_and_flagged(population, history):
    target = {"bowled": history["bowled"], "caught": 2.0 * history["carried"]}  # more catches than carrying edges
    result = fit(population, target, HELD)
    assert result["params"]["catch_conversion"] == 1.0 and result["at_bound"] == ["catch_conversion"]
    assert result["simulated"]["caught"] < target["caught"]


def test_a_bowled_rate_out_of_reach_puts_sigma_seam_on_its_bound(small_population):
    result = fit(small_population, {"bowled": 0.9, "caught": 0.01}, HELD)
    assert "sigma_seam" in result["at_bound"] and result["params"]["sigma_seam"] == pytest.approx(0.03)


def test_the_synthetic_study_covers_every_case():
    rows = synthetic_study("lords", truths=((0.008, 0.30),), deliveries=50_000)
    assert [row["case"] for row in rows] == [*STUDY_CASES, IGNORING_LEAVES]
    by_case = {row["case"]: row for row in rows}
    assert all(by_case["exact"]["recovered"].values())
    assert not by_case[IGNORING_LEAVES]["recovered"]["catch_conversion"]
    # Restitution decides how many edges carry, so a wrong e_z prior goes straight into catch conversion.
    assert by_case["e_z 0.05 too low"]["relative_error"]["catch_conversion"] > 0.10
    assert by_case["e_z 0.05 too high"]["relative_error"]["catch_conversion"] < -0.10


def test_the_objective_is_deterministic(small_population):
    assert simulate_rates(small_population, TRUTH) == simulate_rates(small_population, TRUTH)
    target = {"bowled": 0.004, "caught": 0.01}
    assert fit(small_population, target, HELD) == fit(small_population, target, HELD)


physics = st.fixed_dictionaries({"sigma_swing": st.floats(0.005, 0.15), "sigma_seam": st.floats(0.0005, 0.03),
                                 "e_z": st.floats(0.46, 0.65)})


@settings(max_examples=30, deadline=None)
@given(physics, st.floats(0.0, 0.6))
def test_the_leave_rule_only_removes_edges_and_runs(small_population, params, threshold):
    followed = simulate_rates(small_population, params, threshold)
    played = simulate_rates(small_population, params, leave_threshold=None)
    assert played["left"] == 0.0 and 0.0 < followed["left"] < 1.0
    assert followed["carried"] <= played["carried"] and followed["middled"] <= played["middled"]
    # A left delivery that hits the stumps is always bowled; played, it might have been middled.
    assert followed["bowled"] >= played["bowled"]
    assert followed["carried"] + followed["middled"] + followed["left"] <= 1.0 and followed["bowled"] <= 1.0


@settings(max_examples=30, deadline=None)
@given(st.integers(500, 50_000), st.floats(0.001, 0.02), st.floats(0.001, 0.02), st.integers(0, 10))
def test_bootstrap_targets_are_usable_rates(balls, bowled, caught, seed):
    resamples = bootstrap_targets(balls, {"bowled": bowled, "caught": caught}, draws=20, seed=seed)
    assert len(resamples) == 20
    assert all(1 / balls <= t[k] < 1.0 for t in resamples for k in ("bowled", "caught"))
    assert resamples == bootstrap_targets(balls, {"bowled": bowled, "caught": caught}, draws=20, seed=seed)


def test_a_venue_fit_reports_what_was_fitted_and_what_was_fixed(synthetic_target):
    moments = {"balls": 20_000, "bowled_per_ball": synthetic_target["bowled"],
               "caught_per_ball": synthetic_target["caught"], "caught_keeper_per_ball": synthetic_target["caught"] / 2,
               "runs_per_ball": 0.5}
    result = calibrate_venue("lords", moments, TRUTH, bootstrap=4, deliveries=50_000)
    assert result["fitted"] == ["sigma_seam", "catch_conversion"] and result["fixed"] == ["sigma_swing", "e_z"]
    assert (result["sigma_swing"], result["e_z"]) == (TRUTH["sigma_swing"], TRUTH["e_z"])
    for name in result["fitted"]:
        low, high = result["intervals"][name]
        assert 0.0 < low <= high
    assert 0.0 < result["catch_conversion"] <= 1.0
    assert result["simulated"]["bowled"] == pytest.approx(result["target"]["bowled"], rel=0.05)
    assert result["simulated"]["caught"] == pytest.approx(result["target"]["caught"])
    assert result["runs_middled"] * result["simulated"]["middled"] == pytest.approx(0.5)
    spread = result["catch_conversion_range"]
    assert spread["wicketkeeper_catches_only"] == pytest.approx(spread["all_catches"] / 2, rel=1e-3)
    assert result["rejected_two_parameter_fit"]["why_rejected"]


def test_the_rejected_two_parameter_fit_can_still_be_reproduced(population, history):
    # With every carrying edge caught, that fit recovers its own parameters; it was rejected for what it did to e_z.
    estimate = fit_two_parameters(population, {"bowled": history["bowled"], "caught": history["carried"]}, TRUTH)["params"]
    assert estimate["sigma_seam"] == pytest.approx(TRUTH["sigma_seam"], rel=0.10)
    assert estimate["e_z"] == pytest.approx(TRUTH["e_z"], abs=0.01)


def test_the_committed_calibration_is_physically_sensible():
    calibrated = json.loads((DATA / "calibrated.json").read_text(encoding="utf-8"))
    priors = venue_priors()
    assert set(calibrated["venues"]) == set(priors) == {"lords", "perth", "newlands"}
    assert calibrated["runs_middled"] > 0 and calibrated["leave_threshold"] > 0 and calibrated["notes"]
    for key, venue in calibrated["venues"].items():
        assert venue["fitted"] == ["sigma_seam", "catch_conversion"] and venue["fixed"] == ["sigma_swing", "e_z"]
        assert venue["sigma_seam"] > 0 and 0.0 < venue["catch_conversion"] <= 1.0
        for name in venue["fixed"]:
            assert venue[name] == priors[key][name]
        for name in venue["fitted"]:
            low, high = venue["intervals"][name]
            assert low <= venue[name] <= high
        spread = venue["catch_conversion_range"]
        assert 0.0 < spread["wicketkeeper_catches_only"] <= spread["all_catches"] == venue["catch_conversion"]
        assert {"bowled", "caught", "runs_per_ball"} <= venue["target"].keys() & venue["simulated"].keys()
        assert venue["rejected_two_parameter_fit"]["why_rejected"]

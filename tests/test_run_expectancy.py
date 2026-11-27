"""Run expectancy and wicket cost: the solver against a closed form and simulated innings, and the rate estimates against known rates."""
import json
import math

import numpy as np
import polars as pl
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays

from calibrator.run_expectancy import build_table, estimate_rates, main, solve

SHAPE = (10, 80)
WICKETS_LOST, BALL_AGE = np.indices(SHAPE)[0], np.indices(SHAPE)[1] + 1

# Rates that vary with both wickets lost and ball age.
P_VARYING = 0.04 + 0.004 * WICKETS_LOST + 0.01 * np.cos(2 * np.pi * BALL_AGE / 80)
R_VARYING = 0.6 - 0.03 * WICKETS_LOST + 0.1 * np.sin(2 * np.pi * BALL_AGE / 80)

probabilities = arrays(float, SHAPE, elements=st.floats(0.005, 0.3))
# Mean runs that do not rise as wickets fall. Without that ordering a wicket can move the innings
# into a higher-scoring state, and neither a positive wicket cost nor "more wickets, fewer runs" is a law.
ordered_runs = arrays(float, SHAPE, elements=st.floats(0.05, 2.0)).map(lambda r: -np.sort(-r, axis=0))


def simulate_remaining_runs(p, r, wickets_lost, ball_age, innings, rng):
    """Runs scored from the start of an over until all out, for many innings at once."""
    w = np.full(innings, wickets_lost)
    total = np.zeros(innings)
    a = ball_age - 1
    while (w < 10).any():
        for _ in range(6):
            alive = w < 10
            state = np.minimum(w, 9)
            total = total + np.where(alive, rng.poisson(r[state, a]), 0)
            w = w + (alive & (rng.random(innings) < p[state, a]))
        a = (a + 1) % 80
    return total


def deliveries(wickets_lost, ball_age, legal, runs, wicket):
    """A frame with the parser's columns from one array per quantity that matters here."""
    n = len(wickets_lost)
    return pl.DataFrame(
        {
            "match_id": ["m"] * n,
            "date": ["2020-01-01"] * n,
            "venue": ["Lord's"] * n,
            "venue_key": ["lords"] * n,
            "innings": np.ones(n, dtype=np.int64),
            "over": ball_age,
            "ball_in_over": np.ones(n, dtype=np.int64),
            "legal": legal,
            "runs_batter": np.where(legal, runs, 0),
            "runs_extras": np.where(legal, 0, runs),
            "runs_total": runs,
            "fielder": pl.Series([None] * n, dtype=pl.String),
            "wickets_lost": wickets_lost,
            "ball_age": ball_age,
        }
    ).with_columns(wicket_kind=pl.when(pl.Series(wicket)).then(pl.lit("bowled")))


def sample_deliveries(p, r_legal, cells, legal_per_cell, illegal_per_cell, rng):
    """Deliveries drawn from known rates. Each illegal ball is one run and no wicket."""
    per_cell = legal_per_cell + illegal_per_cell
    w = np.repeat([c[0] for c in cells], per_cell)
    a = np.repeat([c[1] for c in cells], per_cell)
    legal = np.tile(np.arange(per_cell) < legal_per_cell, len(cells))
    wicket = legal & (rng.random(len(w)) < p[w, a - 1])
    runs = np.where(legal, rng.poisson(r_legal[w, a - 1]), 1)
    return deliveries(w, a, legal, runs, wicket)


SMALL_FRAME = sample_deliveries(
    P_VARYING, R_VARYING, [(w, a) for w in range(10) for a in (1, 30, 80)], 200, 10, np.random.default_rng(5)
)


@given(p=st.floats(0.005, 0.5), r=st.floats(0.01, 3.0))
def test_constant_rates_give_the_closed_form(p, r):
    value, wicket_cost = solve(np.full(SHAPE, p), np.full(SHAPE, r))
    np.testing.assert_allclose(value, (10 - WICKETS_LOST) * r / p, rtol=1e-9)
    np.testing.assert_allclose(wicket_cost, r / p, rtol=1e-9)


@pytest.mark.parametrize("wickets_lost, ball_age", [(0, 1), (3, 40), (7, 80), (9, 17)])
def test_value_matches_simulated_innings(wickets_lost, ball_age):
    value, _ = solve(P_VARYING, R_VARYING)
    runs = simulate_remaining_runs(P_VARYING, R_VARYING, wickets_lost, ball_age, 20_000, np.random.default_rng(11))
    standard_error = runs.std(ddof=1) / math.sqrt(len(runs))
    assert abs(runs.mean() - value[wickets_lost, ball_age - 1]) < 4 * standard_error


@settings(max_examples=30, deadline=None)
@given(p=probabilities, r=ordered_runs)
def test_value_is_non_negative_and_falls_with_each_wicket(p, r):
    value, wicket_cost = solve(p, r)
    assert (value >= 0).all()
    assert (wicket_cost > 0).all()
    np.testing.assert_allclose(value[:-1] - value[1:], wicket_cost[:-1])
    np.testing.assert_allclose(value[-1], wicket_cost[-1])


@settings(max_examples=30, deadline=None)
@given(p=probabilities, r=ordered_runs, extra=st.floats(0.001, 0.2))
def test_a_uniformly_higher_wicket_probability_lowers_value(p, r, extra):
    assert (solve(p + extra, r)[0] < solve(p, r)[0]).all()


def test_solve_rejects_an_innings_that_cannot_end():
    with pytest.raises(ValueError):
        solve(np.zeros(SHAPE), np.ones(SHAPE))


@pytest.mark.parametrize("illegal_per_cell", [0, 20_000])
def test_estimate_rates_recovers_known_rates(illegal_per_cell):
    cells = [(w, a) for w in (0, 4, 9) for a in (1, 40, 80)]
    n = 40_000
    frame = sample_deliveries(P_VARYING, R_VARYING, cells, n, illegal_per_cell, np.random.default_rng(3))
    rates = estimate_rates(frame)
    for w, a in cells:
        p, r_legal = P_VARYING[w, a - 1], R_VARYING[w, a - 1]
        # Counting illegal balls as balls would miss p by a third, far outside five standard errors.
        assert abs(rates.p_wicket[w, a - 1] - p) < 5 * math.sqrt(p * (1 - p) / n)
        assert abs(rates.runs_per_ball[w, a - 1] - (r_legal + illegal_per_cell / n)) < 5 * math.sqrt(r_legal / n)


def test_sparse_cells_are_pulled_to_the_marginal_for_their_wickets_lost():
    # 60,000 balls at one wicket per 50 in (0, 1); 60 balls at one wicket per 2 in (0, 2); nothing else.
    w = np.zeros(60_060, dtype=np.int64)
    a = np.where(np.arange(60_060) < 60_000, 1, 2)
    wicket = np.where(a == 1, np.arange(60_060) % 50 == 0, np.arange(60_060) % 2 == 0)
    rates = estimate_rates(deliveries(w, a, np.ones(60_060, dtype=bool), np.ones(60_060, dtype=np.int64), wicket))
    marginal = wicket.sum() / 60_060
    assert marginal < rates.p_wicket[0, 1] < 0.1  # raw rate is 0.5
    assert rates.p_wicket[0, 2] == pytest.approx(marginal)  # empty cell
    assert rates.p_wicket[5, 0] == pytest.approx(marginal)  # no data at five wickets lost at all
    assert np.allclose(rates.runs_per_ball, 1.0)


def test_retirements_are_not_wickets():
    retired = SMALL_FRAME.with_columns(
        wicket_kind=pl.when(pl.col("wicket_kind").is_null() & (pl.col("ball_age") == 30))
        .then(pl.lit("retired hurt"))
        .otherwise(pl.col("wicket_kind"))
    )
    np.testing.assert_array_equal(estimate_rates(retired).p_wicket, estimate_rates(SMALL_FRAME).p_wicket)


def test_table_has_the_documented_shape():
    table = json.loads(json.dumps(build_table(SMALL_FRAME)))
    assert (table["wickets"], table["ball_ages"], table["deliveries"]) == (10, 80, SMALL_FRAME.height)
    for grid in (table["value"], table["wicket_cost"], table["rates"]["p_wicket"], table["rates"]["runs_per_ball"]):
        assert len(grid) == 10 and all(len(row) == 80 for row in grid)
    assert table["wicket_cost"][9][79] == pytest.approx(table["value"][9][79])
    assert table["smoothing"] and table["assumptions"]


@settings(max_examples=10, deadline=None)
@given(seed=st.integers(0, 2**32 - 1))
def test_table_does_not_depend_on_row_order(seed):
    assert build_table(SMALL_FRAME.sample(fraction=1.0, shuffle=True, seed=seed)) == build_table(SMALL_FRAME)


def test_command_line_entry_reads_parquet_and_writes_json(tmp_path):
    source, destination = tmp_path / "deliveries.parquet", tmp_path / "out" / "run_expectancy.json"
    SMALL_FRAME.write_parquet(source)
    main(source, destination)
    assert json.loads(destination.read_text()) == json.loads(json.dumps(build_table(SMALL_FRAME)))


def test_a_frame_outside_the_table_is_rejected():
    with pytest.raises(ValueError):
        estimate_rates(SMALL_FRAME.with_columns(ball_age=pl.lit(81)))
    with pytest.raises(ValueError):
        estimate_rates(SMALL_FRAME.drop("legal"))

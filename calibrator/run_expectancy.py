"""Run expectancy and wicket cost by wickets lost and ball age (ADR-011).

Model. The state is (wickets lost w, ball age a). Each legal ball in that state is a wicket with
probability p(w, a) and adds r(w, a) runs on average. An over is six legal balls; after it ball age
advances by one and wraps from 80 back to 1. The innings ends at ten wickets. V(w, a) is the
expected runs from the start of an over to the end of the innings, and the wicket cost is
lambda(w, a) = V(w, a) - V(w + 1, a) with V(10, a) = 0.

Solver. Exact, not iterative. One over maps the run expectancy at the next ball age to the one at
this ball age linearly: V(., a) = c_a + M_a V(., a + 1), with M_a upper triangular in w. Composing
the 80 overs of a ball's life gives V(., 1) = C + P V(., 1), a 10 x 10 linear system solved
directly; the other 79 ball ages follow by walking the cycle backwards.

Smoothing. Cells with many wickets down and an old ball hold few deliveries, so each cell's rate is
shrunk towards the rate for its wickets lost over all ball ages, with the weight of PRIOR_BALLS
legal balls: rate = (events + PRIOR_BALLS * marginal) / (balls + PRIOR_BALLS). This is the simplest
method that needs no choice of band edges and no fitted model, leaves well-observed cells almost
untouched, and gives an empty cell its marginal. PRIOR_BALLS = 1200 is about 18 wickets at Test
rates, so a cell's own data outweighs the prior once its relative error (about 1 / sqrt(18), a
quarter) is down to the size of a plausible ball-age effect. The cost: in sparse cells the ball-age
effect is flattened. Runs are less noisy than wickets, so the same weight smooths them a little
more than they need.
"""
import itertools
import json
from pathlib import Path
from typing import NamedTuple

import numpy as np
import polars as pl

WICKETS = 10
BALL_AGES = 80
BALLS_PER_OVER = 6
PRIOR_BALLS = 1200

SMOOTHING = (
    "each (wickets lost, ball age) cell is shrunk towards the rate for its wickets lost over all "
    f"ball ages, with a prior weight of {PRIOR_BALLS} legal balls"
)
ASSUMPTIONS = [
    "The state is wickets lost and ball age only. Match situation, innings number, venue, declarations "
    "and the follow-on are ignored, which overstates run expectancy for strong positions (ADR-011).",
    "A new ball is taken every 80 overs, so ball age wraps from 80 back to 1.",
    "The innings ends only when ten wickets have fallen.",
    "Every ball's wicket probability and mean runs depend only on the current wickets lost and ball age.",
    "Every kind of dismissal counts as a wicket, except retirements.",
    "An over is six legal balls. Runs and wickets from wides and no-balls are counted in their "
    "(wickets lost, ball age) cell and divided by that cell's legal balls.",
    "Rates in sparse cells are smoothed: " + SMOOTHING + ".",
]

_ROOT = Path(__file__).resolve().parent.parent
SOURCE = _ROOT / "data" / "cache" / "deliveries.parquet"
DESTINATION = _ROOT / "data" / "run_expectancy.json"
_COLUMNS = {"wickets_lost", "ball_age", "legal", "runs_total", "wicket_kind"}


class Rates(NamedTuple):
    """Per legal ball, as 10 x 80 arrays indexed [wickets lost, ball age - 1]."""

    p_wicket: np.ndarray
    runs_per_ball: np.ndarray


def _cell_counts(frame: pl.DataFrame) -> pl.DataFrame:
    missing = _COLUMNS - set(frame.columns)
    if missing:
        raise ValueError(f"deliveries frame is missing columns: {sorted(missing)}")
    kind = pl.col("wicket_kind").cast(pl.String)
    cells = frame.group_by("wickets_lost", "ball_age").agg(
        balls=pl.col("legal").sum(),
        wickets=(kind.is_not_null() & ~kind.str.starts_with("retired")).sum(),
        runs=pl.col("runs_total").sum(),
    )
    inside = pl.col("wickets_lost").is_between(0, WICKETS - 1) & pl.col("ball_age").is_between(1, BALL_AGES)
    if cells.filter(inside).height != cells.height:
        raise ValueError(f"wickets_lost must be 0 to {WICKETS - 1} and ball_age 1 to {BALL_AGES}")
    return cells


def _grid(cells: pl.DataFrame, column: str) -> np.ndarray:
    grid = np.zeros((WICKETS, BALL_AGES))
    grid[cells["wickets_lost"].to_numpy(), cells["ball_age"].to_numpy() - 1] = cells[column].to_numpy()
    return grid


def _shrink(events, balls, prior_rate):
    return (events + PRIOR_BALLS * prior_rate) / (balls + PRIOR_BALLS)


def _smooth(events: np.ndarray, balls: np.ndarray) -> np.ndarray:
    # The marginal is itself shrunk towards the overall rate, which only matters when a whole
    # wickets-lost row is nearly empty.
    by_wickets_lost = _shrink(events.sum(axis=1), balls.sum(axis=1), events.sum() / balls.sum())
    return _shrink(events, balls, by_wickets_lost[:, None])


def estimate_rates(frame: pl.DataFrame) -> Rates:
    """Smoothed wicket probability and mean runs per legal ball for every (wickets lost, ball age)."""
    cells = _cell_counts(frame)
    balls, wickets, runs = (_grid(cells, column) for column in ("balls", "wickets", "runs"))
    if balls.sum() == 0:
        raise ValueError("deliveries frame has no legal balls")
    return Rates(_smooth(wickets, balls), _smooth(runs, balls))


def _over(p: np.ndarray, r: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(M, c) for one over at one ball age: V(., a) = c + M @ V(., a + 1)."""
    ball = np.diag(1 - p) + np.diag(p[:-1], k=1)
    runs = sum(np.linalg.matrix_power(ball, k) @ r for k in range(BALLS_PER_OVER))
    return np.linalg.matrix_power(ball, BALLS_PER_OVER), runs


def solve(p: np.ndarray, r: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Run expectancy and wicket cost, each 10 x 80, from per-ball wicket probability and mean runs.

    Exact: the cyclic recursion over ball age is one 10 x 10 linear solve (see the module docstring).
    """
    p, r = np.asarray(p, dtype=float), np.asarray(r, dtype=float)
    if p.shape != (WICKETS, BALL_AGES) or r.shape != p.shape:
        raise ValueError(f"p and r must have shape ({WICKETS}, {BALL_AGES})")
    if not ((p > 0) & (p <= 1)).all():
        raise ValueError("every wicket probability must be in (0, 1], or the innings need not end")
    overs = [_over(p[:, a], r[:, a]) for a in range(BALL_AGES)]

    carry, runs = np.eye(WICKETS), np.zeros(WICKETS)
    for through, scored in overs:
        runs = runs + carry @ scored
        carry = carry @ through
    new_ball = np.linalg.solve(np.eye(WICKETS) - carry, runs)

    # From ball age 80 down to 2, each over's value follows from the one after it.
    older = itertools.accumulate(
        reversed(overs[1:]), lambda after, over: over[1] + over[0] @ after, initial=new_ball
    )
    value = np.column_stack([new_ball, *list(older)[:0:-1]])
    wicket_cost = value - np.vstack([value[1:], np.zeros((1, BALL_AGES))])
    return value, wicket_cost


def build_table(frame: pl.DataFrame) -> dict:
    """The run-expectancy document. Grids are indexed [wickets lost][ball age - 1]."""
    rates = estimate_rates(frame)
    value, wicket_cost = solve(rates.p_wicket, rates.runs_per_ball)
    return {
        "wickets": WICKETS,
        "ball_ages": BALL_AGES,
        "value": value.tolist(),
        "wicket_cost": wicket_cost.tolist(),
        "rates": {"p_wicket": rates.p_wicket.tolist(), "runs_per_ball": rates.runs_per_ball.tolist()},
        "smoothing": SMOOTHING,
        "deliveries": frame.height,
        "assumptions": ASSUMPTIONS,
    }


def main(source: Path = SOURCE, destination: Path = DESTINATION) -> None:
    table = build_table(pl.read_parquet(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(table), encoding="utf-8")
    print(
        f"{destination}: {table['deliveries']} deliveries, "
        f"V(0, 1) = {table['value'][0][0]:.1f}, wicket cost at (0, 1) = {table['wicket_cost'][0][0]:.1f}"
    )


if __name__ == "__main__":
    main()

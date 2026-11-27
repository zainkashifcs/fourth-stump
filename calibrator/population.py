"""The simulated batter the calibrator matches history with: fixed releases, the leave rule, per-delivery rates.

A left delivery can only be bowled; a played one can be bowled, edge and carry to the slip
cordon, or be middled. Shared by the shipped fit and the rejected two-parameter fit.
"""
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

import fourth_stump as fs

DATA = Path(__file__).resolve().parents[1] / "data"
PHYSICS = ("sigma_swing", "sigma_seam", "e_z")  # the unobserved parameters of fs.Conditions
LEAVE_THRESHOLD = 0.30  # metres outside off stump; a stated assumption (ADR-010)
BALL_AGES = (3, 8, 13, 18, 23)  # mid-points of five-over blocks of the new-ball window
BOWLING_ENDS = (0, 1)
OFF_STUMP = fs.CONSTANTS["stump_half_width"]
MIDDLED, EDGED_CARRIED, MISSED_BOWLED = (fs.PLAY_OUTCOMES.index(k) for k in ("middled", "edged_carried", "missed_bowled"))


@dataclass(frozen=True)
class Batch:
    """A fixed set of releases at one ball age and bowling end, with the seed its physics draws use."""
    venue: str
    ball_age: int
    end: int
    releases: dict
    seed: int


def venue_priors() -> dict:
    """Priors straight from data/venues.json: fourth_stump.VENUES already has any earlier fit merged in."""
    venues = json.loads((DATA / "venues.json").read_text(encoding="utf-8"))
    return {key: {p: v[p] for p in PHYSICS} for key, v in venues.items() if not key.startswith("_")}


def _conditions(batch: Batch, params: dict) -> fs.Conditions:
    c = fs.conditions_for(batch.venue, batch.ball_age, batch.end)
    for name in PHYSICS:
        setattr(c, name, params[name])
    return c


def make_population(venue: str, deliveries: int = 200_000, seed: int = 2026) -> tuple[Batch, ...]:
    """Right-arm pace over the wicket to a right-hander, spread evenly over the new-ball window and both ends.

    The releases and seeds are fixed here, so every evaluation of an objective reuses the same
    random draws (common random numbers) and the objective is a deterministic function.
    """
    prior = venue_priors()[venue]
    per_batch = deliveries // (len(BALL_AGES) * len(BOWLING_ENDS))
    batches = []
    for ball_age in BALL_AGES:
        for end in BOWLING_ENDS:
            batch_seed = seed + 1000 * ball_age + end
            c = _conditions(Batch(venue, ball_age, end, {}, batch_seed), prior)
            releases = fs.sample_releases(fs.release_spec_for(), c, per_batch, batch_seed)
            batches.append(Batch(venue, ball_age, end, releases, batch_seed))
    return tuple(batches)


def size(population: tuple[Batch, ...]) -> int:
    return sum(len(batch.releases["x"]) for batch in population)


def simulate_rates(population: tuple[Batch, ...], params: dict, leave_threshold: float | None = LEAVE_THRESHOLD) -> dict:
    """Per-delivery rates for a batter following the leave rule. `leave_threshold=None` plays every delivery.

    `carried` is the rate of played deliveries whose edge carries to the slip cordon; how many of
    those are caught is the catch conversion, which the simulation does not apply.
    """
    totals = np.zeros(5)
    for batch in population:
        out = fs.simulate(**batch.releases, conditions=_conditions(batch, params), seed=batch.seed, threads=0)
        play = out["play"]
        left = (out["expected_x"] > OFF_STUMP + leave_threshold if leave_threshold is not None
                else np.zeros(len(play), dtype=bool))
        played = ~left
        totals += (len(play), np.count_nonzero(left),
                   np.count_nonzero(left & (out["leave"] == 1)) + np.count_nonzero(played & (play == MISSED_BOWLED)),
                   np.count_nonzero(played & (play == EDGED_CARRIED)), np.count_nonzero(played & (play == MIDDLED)))
    n, left_count, bowled, carried, middled = (float(x) for x in totals)
    return {"bowled": bowled / n, "carried": carried / n, "middled": middled / n, "left": left_count / n}


def false_shot_share(rates: dict) -> float:
    """Edged or missed, as a share of the deliveries played."""
    return 1.0 - rates["middled"] / (1.0 - rates["left"])


def bootstrap_targets(balls: int, target: dict, draws: int, seed: int = 0) -> list[dict]:
    """Resample the historical counts: each ball is bowled, caught or neither, with the observed frequencies."""
    p = [target["bowled"], target["caught"]]
    counts = np.random.default_rng(seed).multinomial(balls, [*p, 1.0 - sum(p)], size=draws)
    # A resample with no bowled or no caught has no finite log ratio; one event is the smallest usable count.
    return [{"bowled": max(int(b), 1) / balls, "caught": max(int(c), 1) / balls} for b, c, _ in counts]


def percentile_intervals(fits: list[dict], names: tuple[str, ...], level: float = 0.95) -> dict:
    tail = 100.0 * (1.0 - level) / 2.0
    return {name: [float(x) for x in np.percentile([f[name] for f in fits], [tail, 100.0 - tail])] for name in names}

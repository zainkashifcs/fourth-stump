"""Precompute everything the visualisation shows (ADR-013) and write viz/data/trajectories.json.

Run with `make viz-data`. The file's schema is documented in viz/data/SCHEMA.md and is
the only contract between the engine and the visualisation.
"""
import json
from datetime import date
from pathlib import Path

import numpy as np

from . import (ARMS, CONSTANTS, LEAVE_OUTCOMES, PLAY_OUTCOMES, VENUES, Conditions, aim, conditions_for,
               release_spec_for, simulate, summarize, trace)
from .venues import DATA, expected_values

OUT = Path(__file__).resolve().parents[1] / "viz" / "data" / "trajectories.json"
BALL_AGES = (1, 10, 20, 30, 40, 50, 60, 70, 80)
# 135 km/h, good length, aimed at middle stump: swing and wind then carry it towards the fourth-stump corridor.
SPEED, LENGTH, LINE = 37.5, 6.5, 0.0
BATCH, FAN, GAMES, SEED = 200_000, 10, 60, 2026
DEFAULT_WICKET_COST, DEFAULT_RUNS_MIDDLED, WICKETS_LOST = 30.0, 0.5, 3


def wicket_cost(ball_age: int) -> tuple[float, str]:
    """Wicket cost at this ball age from the run-expectancy table, if it has been built."""
    table = DATA / "run_expectancy.json"
    if table.exists():
        return json.loads(table.read_text(encoding="utf-8"))["wicket_cost"][WICKETS_LOST][ball_age - 1], "run-expectancy table"
    return DEFAULT_WICKET_COST, "placeholder"


def runs_middled() -> float:
    calibrated = DATA / "calibrated.json"
    if calibrated.exists():
        return json.loads(calibrated.read_text(encoding="utf-8")).get("runs_middled", DEFAULT_RUNS_MIDDLED)
    return DEFAULT_RUNS_MIDDLED


def release_for(arm: str, line: float = LINE, length: float = LENGTH, speed: float = SPEED) -> list[float]:
    """The same release at every venue: aimed with no swing and no wind."""
    neutral = Conditions()
    neutral.cs_mean = 0.0
    x = release_spec_for(arm).x
    return aim(x, 2.10, speed, line + (x - line) * length / neutral.release_y, length, neutral)


def path_of(t: dict) -> list[list[float]]:
    return np.round(t["path"][:, :3], 4).tolist()


def evaluate(release: list[float], c: Conditions, ball_age: int, seed: int) -> dict:
    """Outcome probabilities and expected values for one release repeated under conditions c."""
    arrays = [np.full(BATCH, v) for v in release]
    summary = summarize(simulate(*arrays, conditions=c, seed=seed))
    cost, _ = wicket_cost(ball_age)
    ev_leave, ev_play = expected_values(summary, cost, runs_middled())
    return {
        "p_wicket_leave": round(summary["p_wicket_leave"], 5), "p_wicket_play": round(summary["p_wicket_play"], 5),
        "p_middled": round(summary["middled"], 5), "p_edged": round(summary["edged_safe"] + summary["edged_caught"], 5),
        "p_missed": round(summary["missed"] + summary["missed_bowled"], 5),
        "wicket_cost": round(cost, 3), "ev_leave": round(ev_leave, 4), "ev_play": round(ev_play, 4),
        "best": "play" if ev_play > ev_leave else "leave",
    }


def scenario(venue: str, ball_age: int, arm: str, end: int, rng: np.random.Generator) -> dict:
    c = conditions_for(venue, ball_age, end, arm)
    release = release_for(arm)
    mean = trace(release, c.cs_mean, 0.0, c)
    fan = [path_of(trace(release, c.cs_mean + c.sigma_swing * rng.standard_normal(),
                         c.sigma_seam * rng.standard_normal(), c, 24)) for _ in range(FAN)]
    return {"venue": venue, "ball_age": ball_age, "arm": arm, "end": end, "path": path_of(mean),
            "bounce_index": mean["bounce_index"], "fan": fan, **evaluate(release, c, ball_age, SEED)}


def game_delivery(i: int, rng: np.random.Generator) -> dict:
    venue, arm = str(rng.choice(list(VENUES))), str(rng.choice(ARMS))
    ball_age, end = int(rng.choice(BALL_AGES)), int(rng.integers(2))
    c = conditions_for(venue, ball_age, end, arm)
    release = release_for(arm, line=rng.normal(LINE, 0.15), length=rng.normal(LENGTH, 1.0), speed=rng.normal(SPEED, 1.5))
    cs = c.cs_mean + c.sigma_swing * rng.standard_normal()
    actual = trace(release, cs, c.sigma_seam * rng.standard_normal(), c)
    # What the batter can know at the bounce: this delivery's swing, not its seam deviation.
    seen = conditions_for(venue, ball_age, end, arm)
    seen.cs_mean, seen.sigma_swing = cs, 0.0
    return {"id": i, "venue": venue, "ball_age": ball_age, "arm": arm, "end": end, "path": path_of(actual),
            "bounce_index": actual["bounce_index"], "outcome_leave": LEAVE_OUTCOMES[actual["leave"]],
            "outcome_play": PLAY_OUTCOMES[actual["play"]], **evaluate(release, seen, ball_age, SEED + i)}


def main() -> None:
    rng = np.random.default_rng(SEED)
    scenarios = [scenario(v, a, arm, end, rng) for v in VENUES for a in BALL_AGES for arm in ARMS for end in (0, 1)]
    games = [g for g in (game_delivery(i, rng) for i in range(GAMES * 2)) if g["bounce_index"] > 0][:GAMES]
    _, cost_source = wicket_cost(1)
    document = {
        "meta": {
            "generated": date.today().isoformat(), "units": "metres, seconds, runs",
            "axes": "origin at the base of the batter's middle stump; +x off side of a right-hander; "
                    "+y up the pitch towards the bowler; +z up",
            "constants": {k: CONSTANTS[k] for k in ("pitch_length", "stump_half_width", "stump_height", "ball_radius",
                                                    "bat_plane_y", "bat_half_width", "corridor_min", "corridor_max")},
            "wicket_cost_source": cost_source, "wickets_lost": WICKETS_LOST, "runs_middled": runs_middled(),
            "deliveries_per_estimate": BATCH,
        },
        "venues": {k: {"name": v["name"], "ball": v["ball"], "ends": v["ends"]} for k, v in VENUES.items()},
        "ball_ages": list(BALL_AGES), "arms": list(ARMS), "scenarios": scenarios, "game": games,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} kB, {len(scenarios)} scenarios, {len(games)} game deliveries)")


if __name__ == "__main__":
    main()

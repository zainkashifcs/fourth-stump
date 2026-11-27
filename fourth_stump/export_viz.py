"""Precompute everything the visualisation shows (ADR-013) and write viz/data/trajectories.json,
plus viz/data/live.json, the inputs of the page's live WebAssembly engine (ADR-016).

Run with `make viz-data`. The file's schema is documented in viz/data/SCHEMA.md and is
the only contract between the engine and the visualisation.
"""
import json
import math
from datetime import date
from pathlib import Path

import numpy as np

from . import (ARMS, CONSTANTS, LEAVE_OUTCOMES, VENUES, Conditions, DeliveryLength, aim, catch_conversion_for,
               conditions_for, length_of, simulate, summarize, trace)
from .venues import DATA, expected_values

OUT = Path(__file__).resolve().parents[1] / "viz" / "data" / "trajectories.json"
LIVE = OUT.with_name("live.json")
BALL_AGES = (1, 10, 20, 30, 40, 50, 60, 70, 80)
# 135 km/h, good length, aimed at middle stump: swing and wind then carry it towards the fourth-stump corridor.
SPEED, LENGTH, LINE = 37.5, length_of(DeliveryLength.GoodLength), 0.0
# The showcase release: right-arm over, wide on the crease; a left-armer's is its mirror. The calibration
# population keeps its own release (venues.release_spec_for).
SHOWCASE_X, SHOWCASE_Z = 0.75, 2.08
LENGTHS = {"good": DeliveryLength.GoodLength, "yorker": DeliveryLength.FourthStumpYorker,
           "bouncer": DeliveryLength.FourthStumpBouncer}
BATCH, FAN, GAMES, SEED = 200_000, 10, 60, 2026
DEFAULT_WICKET_COST, DEFAULT_RUNS_MIDDLED, WICKETS_LOST = 30.0, 0.5, 3
LIVE_BALL_AGE, LIVE_END = 1, 0  # the case live.json's venue conditions describe


def wicket_cost(ball_age: int, wickets_lost: int = WICKETS_LOST) -> tuple[float, str]:
    """Wicket cost at this ball age from the run-expectancy table, if it has been built."""
    table = DATA / "run_expectancy.json"
    if table.exists():
        return json.loads(table.read_text(encoding="utf-8"))["wicket_cost"][wickets_lost][ball_age - 1], "run-expectancy table"
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
    x = showcase_x(arm)
    return aim(x, SHOWCASE_Z, speed, line + (x - line) * length / neutral.release_y, length, neutral)


def showcase_x(arm: str) -> float:
    return SHOWCASE_X if arm == "right" else -SHOWCASE_X


def path_of(t: dict) -> list[list[float]]:
    return np.round(t["path"][:, :3], 4).tolist()


def evaluate(release: list[float], c: Conditions, venue: str, ball_age: int, seed: int) -> dict:
    """Outcome probabilities and expected values for one release repeated under conditions c."""
    arrays = [np.full(BATCH, v) for v in release]
    summary = summarize(simulate(*arrays, conditions=c, seed=seed), catch_conversion=catch_conversion_for(venue))
    cost, _ = wicket_cost(ball_age)
    ev_leave, ev_play = expected_values(summary, cost, runs_middled())
    return {
        "p_wicket_leave": round(summary["p_wicket_leave"], 5), "p_wicket_play": round(summary["p_wicket_play"], 5),
        "p_middled": round(summary["middled"], 5), "p_edged": round(summary["edged_safe"] + summary["edged_carried"], 5),
        "p_missed": round(summary["missed"] + summary["missed_bowled"], 5),
        "wicket_cost": round(cost, 3), "ev_leave": round(ev_leave, 4), "ev_play": round(ev_play, 4),
        "best": "play" if ev_play > ev_leave else "leave",
    }


def random_delivery(release: list[float], venue: str, ball_age: int, end: int, arm: str, rng: np.random.Generator,
                    points: int, read_swing: bool = False) -> tuple[dict, float]:
    """Trace one delivery with its own swing coefficient, seam deviation and restitution.

    With read_swing the batter has read this delivery's swing (the game); otherwise they expect the mean.
    """
    c = conditions_for(venue, ball_age, end, arm)
    cs = c.cs_mean + c.sigma_swing * rng.standard_normal()
    seam = c.sigma_seam * rng.standard_normal()
    c.e_z = float(np.clip(c.e_z + c.sigma_ez * rng.standard_normal(), 0.0, 1.0))
    if read_swing:
        c.cs_mean = cs
    return trace(release, cs, seam, c, points), cs


def outcomes_of(t: dict, venue: str, rng: np.random.Generator) -> dict:
    """Outcome names for both actions. An edge that carries is caught with the venue catch conversion."""
    caught = rng.random() < catch_conversion_for(venue)
    play = ("middled", "edged_safe", "edged_caught" if caught else "edged_safe", "missed", "missed_bowled")[t["play"]]
    return {"leave": LEAVE_OUTCOMES[t["leave"]], "play": play}


def scenario(venue: str, ball_age: int, arm: str, end: int, rng: np.random.Generator) -> dict:
    c = conditions_for(venue, ball_age, end, arm)
    release = release_for(arm)
    mean = trace(release, c.cs_mean, 0.0, c)
    fan = [random_delivery(release, venue, ball_age, end, arm, rng, 24)[0] for _ in range(FAN)]
    return {"venue": venue, "ball_age": ball_age, "arm": arm, "end": end, "path": path_of(mean),
            "bounce_index": mean["bounce_index"], "fan": [path_of(t) for t in fan],
            "fan_bounce_index": [t["bounce_index"] for t in fan],
            "fan_outcomes": [outcomes_of(t, venue, rng) for t in fan],
            **evaluate(release, c, venue, ball_age, SEED)}


def game_delivery(i: int, rng: np.random.Generator) -> dict:
    venue, arm = str(rng.choice(list(VENUES))), str(rng.choice(ARMS))
    ball_age, end = int(rng.choice(BALL_AGES)), int(rng.integers(2))
    release = release_for(arm, line=rng.normal(LINE, 0.15), length=rng.normal(LENGTH, 1.0), speed=rng.normal(SPEED, 1.5))
    actual, cs = random_delivery(release, venue, ball_age, end, arm, rng, 48, read_swing=True)
    outcome = outcomes_of(actual, venue, rng)
    # What the player can know at the bounce: this delivery's swing, not its seam deviation
    # or how high it will bounce. The expected values use a batter who has read that swing.
    seen = conditions_for(venue, ball_age, end, arm)
    seen.cs_mean, seen.sigma_swing = cs, 0.0
    return {"id": i, "venue": venue, "ball_age": ball_age, "arm": arm, "end": end, "path": path_of(actual),
            "bounce_index": actual["bounce_index"], "outcome_leave": outcome["leave"],
            "outcome_play": outcome["play"], **evaluate(release, seen, venue, ball_age, SEED + i)}


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
    LIVE.write_text(json.dumps(live_inputs(), separators=(",", ":")), encoding="utf-8")
    print(f"wrote {LIVE}")


def live_inputs() -> dict:
    """What the page's live WebAssembly engine needs besides the visitor's settings (ADR-016)."""
    neutral = Conditions()
    neutral.cs_mean = 0.0

    def release(arm: str) -> dict:  # as release_for, without speed and length: the engine aims it at the chosen ones
        return {"x": showcase_x(arm), "z": SHOWCASE_Z, "line": LINE}

    def venue(key: str) -> dict:
        right, left = (conditions_for(key, LIVE_BALL_AGE, LIVE_END, arm) for arm in ARMS)
        fields = ("sigma_swing", "sigma_seam", "e_z", "sigma_ez", "pace_retention", "tilt", "wind_y", "release_y", "reaction_time")
        return {"name": VENUES[key]["name"], "conditions": {f: getattr(right, f) for f in fields},
                "swing": {"right": right.cs_mean, "left": left.cs_mean}, "crosswind": right.wind_x,
                # The envelope bounds wind speed, so wind along the pitch narrows the crosswind allowed.
                "max_crosswind": math.sqrt(CONSTANTS["max_wind"] ** 2 - right.wind_y ** 2),
                "catch_conversion": catch_conversion_for(key), "runs_middled": runs_middled()}

    costs = [wicket_cost(LIVE_BALL_AGE, w) for w in range(10)]
    return {"meta": {"generated": date.today().isoformat(), "ball_age": LIVE_BALL_AGE, "bowling_end": LIVE_END,
                     "wicket_cost_source": costs[0][1]},
            "release": {arm: release(arm) for arm in ARMS},
            "lengths": {name: {"bounce_y": length_of(l), "from_release": neutral.release_y - length_of(l)}
                        for name, l in LENGTHS.items()},
            "venues": {key: venue(key) for key in VENUES},
            "wicket_cost": {"ball_age": LIVE_BALL_AGE, "by_wickets_lost": [c for c, _ in costs]}}


if __name__ == "__main__":
    main()

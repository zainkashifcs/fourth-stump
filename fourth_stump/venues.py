"""Venue conditions and outcome summaries, shared by the calibrator and the visualisation export."""
import json
import math
from pathlib import Path

import numpy as np

from ._engine import PLAY_OUTCOMES, Conditions, ReleaseSpec

DATA = Path(__file__).resolve().parents[1] / "data"
ARMS = ("right", "left")  # over the wicket to a right-hander


def _load_venues() -> dict:
    venues = {k: v for k, v in json.loads((DATA / "venues.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}
    calibrated = DATA / "calibrated.json"
    if calibrated.exists():
        for key, fit in json.loads(calibrated.read_text(encoding="utf-8")).get("venues", {}).items():
            venues[key].update({k: fit[k] for k in ("sigma_swing", "sigma_seam", "e_z", "catch_conversion") if k in fit})
    return venues


VENUES = _load_venues()


def conditions_for(venue: str, ball_age: float = 1.0, end: int = 0, arm: str = "right") -> Conditions:
    """Conditions for a venue at a ball age (overs), bowling end (0 or 1) and bowler arm."""
    v = VENUES[venue]
    flip = -1.0 if end == 1 else 1.0  # the other end reverses the wind and the slope
    c = Conditions()
    # Swing fades with ball age. A left-armer's stock delivery swings the other way.
    c.cs_mean = v["cs0"] * 0.5 ** ((ball_age - 1.0) / v["swing_half_life_overs"]) * (1.0 if arm == "right" else -1.0)
    c.sigma_swing = v["sigma_swing"]
    c.sigma_seam = v["sigma_seam"]
    c.e_z = v["e_z"]
    c.sigma_ez = v["sigma_ez"]
    c.tilt = flip * math.radians(v["tilt_deg"])
    c.wind_x = flip * v["wind"][0]
    c.wind_y = flip * v["wind"][1]
    return c


def release_spec_for(arm: str = "right") -> ReleaseSpec:
    spec = ReleaseSpec()
    spec.x = 0.45 if arm == "right" else -0.45
    return spec


def catch_conversion_for(venue: str) -> float:
    """Share of carrying edges that are caught at this venue; 1.0 until calibrated (ADR-010)."""
    return VENUES[venue].get("catch_conversion", 1.0)


def summarize(outcomes: dict, mask: np.ndarray | None = None, catch_conversion: float = 1.0) -> dict:
    """Outcome probabilities for a simulated batch, optionally over a subset of deliveries."""
    leave, play = outcomes["leave"], outcomes["play"]
    if mask is not None:
        leave, play = leave[mask], play[mask]
    n = max(len(leave), 1)
    counts = np.bincount(play, minlength=len(PLAY_OUTCOMES))
    summary = {name: counts[i] / n for i, name in enumerate(PLAY_OUTCOMES)}
    summary["n"] = len(leave)
    summary["p_wicket_leave"] = float(leave.sum()) / n
    summary["p_wicket_play"] = catch_conversion * summary["edged_carried"] + summary["missed_bowled"]
    return summary


def expected_values(summary: dict, wicket_cost: float, runs_middled: float) -> tuple[float, float]:
    """(EV of leave, EV of play): expected runs minus wicket cost times dismissal probability."""
    return (-wicket_cost * summary["p_wicket_leave"],
            runs_middled * summary["middled"] - wicket_cost * summary["p_wicket_play"])

"""Historical rates per venue over the new-ball window, the calibrator's targets (ADR-009)."""
import json
from pathlib import Path

import polars as pl

NEW_BALL_WINDOW = (1, 25)  # overs of an innings, 1-based and inclusive
MOMENTS_PATH = Path(__file__).resolve().parents[1] / "data" / "calibration_moments.json"
KEYS = ("match_id", "innings")

DEFINITIONS = {
    "balls": "legal deliveries in the window; wides and no-balls are dropped, with anything that happened on them",
    "bowled": "wicket_kind == 'bowled'",
    "caught": "wicket_kind == 'caught', every catch by a fielder (caught and bowled is a separate kind, not counted)",
    "caught_keeper": "the 'caught' dismissals whose fielder is the innings' wicketkeeper by the proxy in cordon_proxy",
    "other_dismissals": "lbw, run out, stumped, caught and bowled, hit wicket and the rest: outside the model "
                        "(ADR-007), so not wickets here, though their balls count",
    "runs_batter": "runs off the bat on legal deliveries",
}
PROXY_METHOD = (
    "Cricsheet does not label fielding positions. A wicketkeeper is recognised only through stumpings: a 'known "
    "keeper' is any fielder credited with a stumping anywhere in the men's Test archive. In each innings at most one "
    "known keeper is taken to be keeping: of those with a catch or stumping in that innings, the one with most "
    "stumpings in the match, then most dismissals in the match, then most stumpings in the archive. A 'caught' "
    "dismissal by that fielder is a keeper catch."
)
PROXY_QUALITY = (
    "Keeper catches are a lower bound on cordon catches, because slips and gully cannot be identified at all; all "
    "catches are the upper bound. Measured, in archive_counts: where two known keepers caught in the same innings "
    "only one can have been keeping, so the rule keeps one and rejects the rest "
    "(rejected_as_second_keeper_in_innings); which of the two it keeps is a judgement by the ranking above, not an "
    "observation. Not measurable from this data: a known keeper fielding elsewhere is counted wrongly when no "
    "other known keeper caught in that innings, and a keeper with no stumping in the archive is missed. The split "
    "was not checked against an external source."
)


def _credited(table: pl.DataFrame) -> pl.DataFrame:
    return table.filter(pl.col("wicket_kind").is_in(["caught", "stumped"]) & pl.col("fielder").is_not_null())


def innings_keepers(table: pl.DataFrame) -> pl.DataFrame:
    """One row per innings in which a known keeper took a catch or stumping: (match_id, innings, keeper)."""
    credited = _credited(table).with_columns(stumping=pl.col("wicket_kind") == "stumped")
    career = credited.group_by("fielder").agg(career_stumpings=pl.col("stumping").sum()).filter(
        pl.col("career_stumpings") > 0)
    in_match = credited.group_by("match_id", "fielder").agg(
        match_stumpings=pl.col("stumping").sum(), match_dismissals=pl.len())
    ranking = ["match_stumpings", "match_dismissals", "career_stumpings", "fielder"]
    return (credited.select(*KEYS, "fielder").unique()
            .join(career, on="fielder")
            .join(in_match, on=["match_id", "fielder"])
            .sort(ranking, descending=True)
            .group_by(KEYS, maintain_order=True).first()
            .select(*KEYS, keeper="fielder"))


def with_keeper_catches(table: pl.DataFrame) -> pl.DataFrame:
    """The table with a boolean `keeper_catch` column."""
    caught = pl.col("wicket_kind") == "caught"
    return (table.join(innings_keepers(table), on=KEYS, how="left")
            .with_columns(keeper_catch=(caught & (pl.col("fielder") == pl.col("keeper"))).fill_null(False))
            .drop("keeper"))


def _in_window(table: pl.DataFrame) -> pl.DataFrame:
    first, last = NEW_BALL_WINDOW
    return table.filter(pl.col("legal") & pl.col("over").is_between(first, last))


def proxy_counts(table: pl.DataFrame) -> dict:
    """How much the one-keeper-per-innings rule changes the plain 'ever made a stumping' proxy, archive-wide."""
    known = _credited(table).filter(pl.col("wicket_kind") == "stumped")["fielder"].unique()
    caught = with_keeper_catches(table).filter(pl.col("wicket_kind") == "caught")
    by_known = int(caught["fielder"].is_in(known.implode()).sum())
    kept = int(caught["keeper_catch"].sum())
    return {"known_keepers": len(known), "catches": len(caught), "catches_by_a_known_keeper": by_known,
            "keeper_catches": kept, "rejected_as_second_keeper_in_innings": by_known - kept,
            "keeper_share_of_catches": round(kept / max(len(caught), 1), 4)}


def _venue_row(row: dict) -> dict:
    balls = row["balls"]
    rates = {f"{name}_per_ball": row[name] / balls for name in ("bowled", "caught", "caught_keeper")}
    return {**{k: v for k, v in row.items() if k != "venue_key"}, **rates, "runs_per_ball": row["runs_batter"] / balls}


def venue_moments(table: pl.DataFrame) -> dict:
    """Counts and per-ball rates over the new-ball window for each keyed venue."""
    kind = pl.col("wicket_kind")
    window = _in_window(with_keeper_catches(table)).filter(pl.col("venue_key").is_not_null())
    rows = window.group_by("venue_key").agg(
        matches=pl.col("match_id").n_unique(),
        first_date=pl.col("date").min().cast(pl.String),
        last_date=pl.col("date").max().cast(pl.String),
        balls=pl.len(),
        bowled=(kind == "bowled").sum(),
        caught=(kind == "caught").sum(),
        caught_keeper=pl.col("keeper_catch").sum(),
        other_dismissals=(kind.is_not_null() & ~kind.is_in(["bowled", "caught"])).sum(),
        runs_batter=pl.col("runs_batter").sum(),
    ).sort("venue_key")
    return {row["venue_key"]: _venue_row(row) for row in rows.iter_rows(named=True)}


def build_moments(table: pl.DataFrame) -> dict:
    return {
        "source": "Cricsheet men's Tests, https://cricsheet.org/downloads/tests_json.zip (ODC-By 1.0, see ADR-009)",
        "new_ball_window_overs": list(NEW_BALL_WINDOW),
        "definitions": DEFINITIONS,
        "cordon_proxy": {"method": PROXY_METHOD, "quality": PROXY_QUALITY, "archive_counts": proxy_counts(table)},
        "venues": venue_moments(table),
    }


def write_moments(moments: dict, path: Path = MOMENTS_PATH) -> Path:
    path.write_text(json.dumps(moments, indent=2) + "\n", encoding="utf-8")
    return path

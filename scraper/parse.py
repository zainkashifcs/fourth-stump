"""Cricsheet's Test archive as one per-ball table (the schema is fixed by the cycle spec)."""
import zipfile
from collections.abc import Iterable
from pathlib import Path

import polars as pl
from pydantic import ValidationError

from .models import Delivery, Match

SCHEMA = {
    "match_id": pl.String, "date": pl.Date, "venue": pl.String, "venue_key": pl.String,
    "innings": pl.Int64, "over": pl.Int64, "ball_in_over": pl.Int64, "legal": pl.Boolean,
    "runs_batter": pl.Int64, "runs_extras": pl.Int64, "runs_total": pl.Int64,
    "wicket_kind": pl.String, "fielder": pl.String, "wickets_lost": pl.Int64, "ball_age": pl.Int64,
}
# Venue strings as they appear in the archive (inspected 2026-11-27), matched as lower-case prefixes.
# "optus stadium" is Perth Stadium's sponsored name; the archive does not use it today.
VENUE_PREFIXES = {
    "lord's": "lords",
    "perth stadium": "perth", "optus stadium": "perth", "waca": "perth",
    "newlands": "newlands",
}
NOT_A_WICKET = frozenset({"retired hurt", "retired not out"})
ILLEGAL_EXTRAS = frozenset({"wides", "noballs"})
NEW_BALL_OVERS = 80
DELIVERIES_PATH = Path(__file__).resolve().parents[1] / "data" / "cache" / "deliveries.parquet"


class ParseError(ValueError):
    """A match file did not have the structure the table needs."""


def venue_key(venue: str) -> str | None:
    name = venue.strip().lower()
    return next((key for prefix, key in VENUE_PREFIXES.items() if name.startswith(prefix)), None)


def ball_age(over: int) -> int:
    """Overs bowled with the current ball, assuming a new ball is taken every 80 overs."""
    return (over - 1) % NEW_BALL_OVERS + 1


def _dismissal(delivery: Delivery) -> tuple[str | None, str | None, int]:
    """(kind, first fielder, wickets fallen) for a delivery. A retirement is not a wicket."""
    wickets = [w for w in delivery.wickets if w.kind not in NOT_A_WICKET]
    if not wickets:
        return None, None, 0
    first = wickets[0]
    return first.kind, (first.fielders[0].name if first.fielders else None), len(wickets)


def match_rows(match_id: str, match: Match) -> list[tuple]:
    """One row per delivery, in SCHEMA order."""
    info = match.info
    head = (match_id, info.dates[0], info.venue, venue_key(info.venue))
    rows = []
    for innings_number, innings in enumerate(match.innings, start=1):
        wickets_lost = 0
        for over in innings.overs:
            number = over.over + 1
            for position, delivery in enumerate(over.deliveries, start=1):
                kind, fielder, fallen = _dismissal(delivery)
                rows.append((*head, innings_number, number, position, ILLEGAL_EXTRAS.isdisjoint(delivery.extras),
                             delivery.runs.batter, delivery.runs.extras, delivery.runs.total,
                             kind, fielder, wickets_lost, ball_age(number)))
                wickets_lost += fallen
    return rows


def parse_match(match_id: str, raw: bytes | str) -> Match:
    try:
        return Match.model_validate_json(raw)
    except ValidationError as error:
        raise ParseError(f"match {match_id}: {error}") from error


def to_table(matches: Iterable[tuple[str, Match]]) -> pl.DataFrame:
    """The per-ball table for men's Tests, from (match id, match) pairs. Other matches are dropped."""
    frames = [pl.DataFrame(match_rows(match_id, match), schema=SCHEMA, orient="row")
              for match_id, match in matches
              if match.info.gender == "male" and match.info.match_type == "Test"]
    return pl.concat(frames) if frames else pl.DataFrame(schema=SCHEMA)


def parse_archive(archive: Path) -> pl.DataFrame:
    with zipfile.ZipFile(archive) as z:
        names = sorted(n for n in z.namelist() if n.endswith(".json"))
        return to_table((Path(n).stem, parse_match(Path(n).stem, z.read(n))) for n in names)


def write_table(table: pl.DataFrame, path: Path = DELIVERIES_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    table.write_parquet(path)
    return path

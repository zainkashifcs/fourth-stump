"""The Cricsheet pipeline, offline: cached download, the per-ball table and the calibration moments."""
import asyncio
import zipfile
from pathlib import Path

import httpx
import polars as pl
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from scraper.download import DownloadError, fetch_archive
from scraper.models import Match
from scraper.moments import build_moments, with_keeper_catches
from scraper.parse import SCHEMA, ParseError, parse_archive, parse_match, to_table, venue_key

FIXTURES = Path(__file__).parent / "fixtures" / "cricsheet"
SPEC_COLUMNS = ["match_id", "date", "venue", "venue_key", "innings", "over", "ball_in_over", "legal", "runs_batter",
                "runs_extras", "runs_total", "wicket_kind", "fielder", "wickets_lost", "ball_age"]


@pytest.fixture(scope="module")
def table(tmp_path_factory) -> pl.DataFrame:
    archive = tmp_path_factory.mktemp("archive") / "tests_json.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("README.txt", "synthetic fixtures")
        for path in FIXTURES.glob("*.json"):
            z.write(path, path.name)
    return parse_archive(archive)


# ---- download ---------------------------------------------------------------------------------

def fetch(handler, dest, **options):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_archive("https://example.test/a.zip", dest, client=client, delay=0, backoff=0, **options)
    return asyncio.run(run())


def test_a_cached_archive_is_never_downloaded_again(tmp_path):
    dest = tmp_path / "a.zip"
    dest.write_bytes(b"cached")

    def refuse(request):
        raise AssertionError("the network was touched although the archive is cached")

    assert fetch(refuse, dest) == dest
    assert dest.read_bytes() == b"cached"


def test_a_failed_request_is_retried_and_the_archive_cached(tmp_path):
    statuses = iter([503, 200])
    calls = []

    def flaky(request):
        calls.append(request.url)
        status = next(statuses)
        return httpx.Response(status, content=b"zip-bytes" if status == 200 else b"")

    dest = fetch(flaky, tmp_path / "cache" / "a.zip")
    assert dest.read_bytes() == b"zip-bytes" and len(calls) == 2
    assert not list(dest.parent.glob("*.part"))


def test_a_refusal_is_reported_without_retrying(tmp_path):
    calls = []

    def forbidden(request):
        calls.append(request.url)
        return httpx.Response(403)

    with pytest.raises(DownloadError):
        fetch(forbidden, tmp_path / "a.zip")
    assert len(calls) == 1 and not (tmp_path / "a.zip").exists()


def test_giving_up_after_repeated_failures_leaves_no_cache(tmp_path):
    with pytest.raises(DownloadError):
        fetch(lambda request: httpx.Response(503), tmp_path / "a.zip", attempts=3)
    assert not list(tmp_path.iterdir())


# ---- the per-ball table -------------------------------------------------------------------------

def test_the_table_has_exactly_the_columns_in_the_spec(table):
    assert table.columns == SPEC_COLUMNS == list(SCHEMA)


def test_only_mens_tests_are_kept(table):
    assert sorted(table["match_id"].unique()) == ["9000001", "9000002"]


def test_venue_strings_map_to_venue_keys(table):
    assert venue_key("Lord's") == "lords"
    assert venue_key("WACA, Perth") == venue_key("Perth Stadium") == venue_key("Optus Stadium, Perth") == "perth"
    assert venue_key("Newlands, Cape Town") == "newlands"
    assert venue_key("The Oval") is None and venue_key("Kensington Oval, Bridgetown") is None
    assert dict(table.select("match_id", "venue_key").unique().iter_rows()) == {"9000001": "lords", "9000002": "perth"}


def test_the_first_innings_at_lords_is_parsed_ball_by_ball(table):
    innings = table.filter((pl.col("match_id") == "9000001") & (pl.col("innings") == 1))
    assert innings["over"].to_list() == [1] * 7 + [2] * 7 + [26] * 6
    assert innings["ball_in_over"].to_list() == [*range(1, 8), *range(1, 8), *range(1, 7)]
    assert innings["legal"].to_list() == [True, True, False, *[True] * 4, False, *[True] * 12]
    assert innings["wickets_lost"].to_list() == [0, 0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 6]
    assert innings["wicket_kind"].drop_nulls().to_list() == ["bowled", "caught", "lbw", "caught", "stumped", "caught"]
    assert innings["fielder"].drop_nulls().to_list() == ["S Gloves", "S Slipper", "S Gloves", "S Gloves"]
    assert innings["runs_batter"].sum() == 11 and innings["runs_extras"].sum() == 3 and innings["runs_total"].sum() == 14
    assert innings["ball_age"].to_list() == innings["over"].to_list()


def test_a_retirement_is_not_a_wicket(table):
    retired = table.filter((pl.col("match_id") == "9000001") & (pl.col("innings") == 1) & (pl.col("over") == 2)
                           & (pl.col("ball_in_over") == 7))
    assert retired["wicket_kind"].to_list() == [None]


def test_a_malformed_match_names_its_file():
    with pytest.raises(ParseError, match="9000009"):
        parse_match("9000009", '{"info": {"dates": [], "venue": "Lord\'s", "gender": "male", "match_type": "Test"}}')


extras = st.sampled_from([{}, {}, {}, {"wides": 1}, {"noballs": 1}, {"legbyes": 2}, {"byes": 1}, {"penalty": 5}])
wickets = st.sampled_from([[], [], [], [{"kind": "bowled"}], [{"kind": "retired hurt"}],
                           [{"kind": "caught", "fielders": [{"name": "F One"}]}],
                           [{"kind": "run out", "fielders": [{"substitute": True}]}],
                           [{"kind": "stumped", "fielders": [{"name": "F Two"}]}, {"kind": "retired hurt"}]])
delivery = st.builds(
    lambda batter, extra, fallen: {"runs": {"batter": batter, "extras": sum(extra.values()),
                                            "total": batter + sum(extra.values())}, "extras": extra, "wickets": fallen},
    st.integers(0, 6), extras, wickets)
innings_of_overs = st.lists(st.lists(delivery, min_size=1, max_size=8), min_size=1, max_size=12)
matches = st.builds(
    lambda start, innings: {
        "info": {"dates": ["2010-01-01"], "venue": "Lord's", "gender": "male", "match_type": "Test"},
        "innings": [{"team": "T", "overs": [{"over": start + i, "deliveries": balls} for i, balls in enumerate(overs)]}
                    for overs in innings]},
    st.integers(0, 170), st.lists(innings_of_overs, min_size=1, max_size=4))


@settings(max_examples=60, deadline=None)
@given(matches)
def test_parser_invariants_hold_for_any_match(raw):
    parsed = to_table([("m", Match.model_validate(raw))])
    deliveries = [(n, over["over"] + 1, d) for n, inn in enumerate(raw["innings"], 1)
                  for over in inn["overs"] for d in over["deliveries"]]
    assert len(parsed) == len(deliveries)
    assert parsed["ball_age"].is_between(1, 80).all()
    assert (parsed["ball_age"] == (parsed["over"] - 1) % 80 + 1).all()
    assert parsed["legal"].to_list() == [not ({"wides", "noballs"} & d["extras"].keys()) for _, _, d in deliveries]
    assert (parsed["runs_total"] == parsed["runs_batter"] + parsed["runs_extras"]).all()
    fell = [sum(w["kind"] != "retired hurt" for w in d["wickets"]) for _, _, d in deliveries]
    assert (parsed["wicket_kind"].is_not_null().to_list()) == [f > 0 for f in fell]
    for number, part in parsed.group_by("innings", maintain_order=True):
        lost = part["wickets_lost"].to_list()
        innings_fell = [f for (n, _, _), f in zip(deliveries, fell) if n == number[0]]
        assert lost[0] == 0 and all(b >= a for a, b in zip(lost, lost[1:]))  # never decreases
        assert [b - a for a, b in zip(lost, lost[1:])] == innings_fell[:-1]  # counts wickets before the ball


# ---- calibration moments --------------------------------------------------------------------------

def test_moments_count_the_new_ball_window_per_venue(table):
    venues = build_moments(table)["venues"]
    assert set(venues) == {"lords", "perth"}
    lords = venues["lords"]
    assert {k: lords[k] for k in ("matches", "balls", "bowled", "caught", "caught_keeper", "other_dismissals",
                                  "runs_batter")} == {"matches": 1, "balls": 18, "bowled": 1, "caught": 3,
                                                      "caught_keeper": 2, "other_dismissals": 4, "runs_batter": 14}
    assert lords["bowled_per_ball"] == pytest.approx(1 / 18) and lords["runs_per_ball"] == pytest.approx(14 / 18)
    assert lords["caught_per_ball"] == pytest.approx(3 / 18) and lords["caught_keeper_per_ball"] == pytest.approx(2 / 18)


def test_only_one_known_keeper_is_keeping_in_an_innings(table):
    perth = build_moments(table)["venues"]["perth"]
    assert (perth["balls"], perth["caught"], perth["caught_keeper"]) == (6, 2, 1)
    keeper_catches = with_keeper_catches(table).filter(pl.col("keeper_catch"))
    assert sorted(keeper_catches["fielder"].to_list()) == ["N Former", "N Gloves", "S Gloves", "S Gloves"]
    counts = build_moments(table)["cordon_proxy"]["archive_counts"]
    assert counts["known_keepers"] == 3 and counts["rejected_as_second_keeper_in_innings"] == 1


def test_keeper_catches_never_exceed_all_catches(table):
    for venue in build_moments(table)["venues"].values():
        assert 0 <= venue["caught_keeper"] <= venue["caught"]

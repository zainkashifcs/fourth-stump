"""`uv run python -m scraper`: archive -> per-ball table -> calibration moments."""
import asyncio
import json

from .download import fetch_archive
from .moments import build_moments, write_moments
from .parse import parse_archive, write_table


def main() -> None:
    archive = asyncio.run(fetch_archive())
    table = parse_archive(archive)
    print(f"{archive.name}: {table['match_id'].n_unique()} men's Tests, {len(table)} deliveries")
    print(f"wrote {write_table(table)}")
    moments = build_moments(table)
    print(f"wrote {write_moments(moments)}")
    print(json.dumps(moments["cordon_proxy"]["archive_counts"]))
    for venue, row in moments["venues"].items():
        print(venue, json.dumps(row))


if __name__ == "__main__":
    main()

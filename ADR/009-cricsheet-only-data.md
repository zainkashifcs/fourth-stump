# Cricsheet is the only data source; no commentary scraping

The original brief called for scraping ball-by-ball Test commentary for line, length and batter action. ESPNcricinfo answers a script with "403 Access Denied", even for `robots.txt`, and getting past that would mean evading bot protection. We use Cricsheet's Test archive instead: every Test ball by ball in one 17.5 MB zip, with batter, bowler, runs, extras, dismissal kind, fielders and venue.

## Consequences

- There is no line, length, batter action or bowler type in the data. Nothing in the project may depend on observing them.
- The calibration sample is overs 1–25 of each innings (the new-ball window), a stand-in for pace bowling.
- Runs for a middled delivery cannot be "the mean off played fourth-stump deliveries" as ADR-007 first recorded. It is set so that simulated runs per ball match the historical figure.
- Cordon catches are not labelled. Where the fielder of a `caught` dismissal can be identified as the wicketkeeper, that sharpens the cordon rate; otherwise all catches are an upper bound and the README says so.
- The downloader caches the archive on disk, and a small pre-aggregated calibration dataset is committed so everything runs offline.
- Commentary parsing is cut. It returns only if commentary text is obtained legitimately.
- "Perth" pools two grounds: 13 Tests at the WACA and 6 at Perth Stadium. Perth Stadium alone has too few new-ball deliveries to fit. The pitches differ, so Perth's fitted values describe neither ground exactly.
- Only men's Tests are used (905 of the 929 matches in the archive).

## Licence

Checked at the source on 2026-11-27.

- Cricsheet's [licensing page](https://cricsheet.org/licensing/) says: "Most of the data is covered by the Open Data Commons Attribution License, whereas the XML match data alone is available under the Creative Commons Attribution 4.0 International License." We use the JSON match data, so the licence is the Open Data Commons Attribution License, ODC-By 1.0 ([full text](http://opendatacommons.org/licenses/by/1.0/)).
- The archive we download, `tests_json.zip`, carries the same licence as `LICENSE.txt`. Cricsheet announced this on 7 October 2026 in "[A License for match data, and the addition of the Venue Register](https://cricsheet.org/article/licensing-and-venues-registry/)"; before that the JSON match data had no stated licence.
- Cricsheet's summary of what ODC-By asks: attribute any public use of the database or of works produced from it, make the licence clear to others, and keep any notices on the original intact. Sharing, adapting and producing works from the data are allowed.
- What that means here: the files we commit that are derived from the data (`data/calibration_moments.json`, `data/calibrated.json`, `data/run_expectancy.json`) need a visible credit to Cricsheet with the licence named, which belongs in the README. The archive and the per-ball table stay in the git-ignored `data/cache/` and are not redistributed.
- `https://cricsheet.org/robots.txt` allows `/downloads/` (it disallows only `/data/`). The downloader makes one request and never repeats it while the cached file exists.
- Read: the licensing page, the announcement, and the start of `LICENSE.txt` in the archive. The full licence text was not read end to end, and this is not legal advice.

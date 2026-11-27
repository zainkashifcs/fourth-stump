# Cricsheet is the only data source; no commentary scraping

The original brief called for scraping ball-by-ball Test commentary for line, length and batter action. ESPNcricinfo answers a script with "403 Access Denied", even for `robots.txt`, and getting past that would mean evading bot protection. We use Cricsheet's Test archive instead: every Test ball by ball in one 17.5 MB zip, with batter, bowler, runs, extras, dismissal kind, fielders and venue.

## Consequences

- There is no line, length, batter action or bowler type in the data. Nothing in the project may depend on observing them.
- The calibration sample is overs 1–25 of each innings (the new-ball window), a stand-in for pace bowling.
- Runs for a middled delivery cannot be "the mean off played fourth-stump deliveries" as ADR-007 first recorded. It is set so that simulated runs per ball match the historical figure.
- Cordon catches are not labelled. Where the fielder of a `caught` dismissal can be identified as the wicketkeeper, that sharpens the cordon rate; otherwise all catches are an upper bound and the README says so.
- The downloader caches the archive on disk, and a small pre-aggregated calibration dataset is committed so everything runs offline.
- Commentary parsing is cut. It returns only if commentary text is obtained legitimately.

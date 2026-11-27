# The engine header runs in the browser as WebAssembly, split across a pool of Web Workers

The page's live panel runs the real engine, not a JavaScript copy of it. `cpp/wasm/live.cpp` is a small C interface over the engine header, compiled by Emscripten (`make wasm`) to `viz/wasm/engine.mjs` (an ES module, 4.3 kB) and `viz/wasm/engine.wasm` (27 kB). Both are committed, so the page still needs no build step. `viz/js/engine-wasm.js` is the only thing the page talks to. `loadEngine({ workers })` resolves to `{ capacity, limits, lengths, threads, run, sample }`. One instance runs in the page and one in each pooled Web Worker (`viz/js/engine-worker.js`).

`run` aims the showcase release at the chosen speed and named length with `aim` and `bounce_target`, as the exporter does. It splits the batch into pieces of consecutive delivery indices and hands them to the workers. Each worker runs `simulate_batch` with the default random-number policy on its pieces and returns integer outcome counts. The page's instance adds the counts and summarises them with `Summary`, and traces the mean delivery as the binding's `trace` does. `sample` traces one delivery of the same batch. `viz/data/live.json`, written by `make viz-data` beside trajectories.json, carries everything else a run needs: venue conditions, the release, the named lengths, catch conversion, runs when middled and the wicket costs.

This amends ADR-013, where a browser engine was rejected because Emscripten was not installed.

## Why

The precomputed grid covers three venues, nine ball ages, two arms and two ends at one speed and one length. A visitor who wants to move the speed, the length, the swing or the crosswind needs the engine itself. Running the header, rather than porting it, means the browser can only disagree with the native engine where the platform maths library does.

## Considered options

- **Threads (Emscripten pthreads with OpenMP)**: rejected. They need `SharedArrayBuffer`, which needs cross-origin isolation headers that GitHub Pages cannot send.
- **A pool of Web Workers, each with its own module instance**: chosen. Workers need no special headers, and a batch splits cleanly because every delivery's random draws are a function of (seed, delivery index) alone (ADR-003). A worker sends back seven integers and, for the piece holding the first 256 deliveries, their arrivals: no memory is shared and nothing large is copied.
- **Equal shares per worker**: rejected after measuring. The i5-13450HX mixes performance and efficiency cores, so equal shares wait for the slowest core. Each worker gets four pieces' worth on average, handed out as it comes free.
- **One instance in the page only**: kept as the fallback when Workers are missing or none starts within 10 s. A pool keeps whichever workers did start.
- **A JavaScript port of the kernel**: rejected. It would be a second implementation to keep in step with the header, and the cross-platform check below would test the port, not the engine.
- **`-msimd128`**: tried and left off. It changed nothing measurable (18.8 against 18.8 ms for 50,000 deliveries in one instance, median of 21 runs) and gave bit-identical results. The kernel does not vectorise natively either (ADR-014).

## Named lengths

The engine header gains `DeliveryLength { GoodLength, FourthStumpYorker, FourthStumpBouncer }`. `length_of` gives each one's bounce distance from the batter's stumps, the convention `aim` and the envelope use. `bounce_target` turns that into the bounce point for a release position and a line, so a length is aimed with the existing `aim`.

| Length | From the stumps | From the release plane | Envelope (−1 m to 10 m from the stumps) |
|---|---|---|---|
| Good length | 6.50 m | 12.40 m | inside |
| Fourth-stump yorker | −0.40 m (behind the stumps) | 19.30 m | inside |
| Fourth-stump bouncer | 8.65 m | 10.25 m | inside |

Good length is the showcase delivery's existing length and was kept, although 12.4 m from release is short of the 13.5 to 15.0 m that was asked for: moving it would move every published number. The yorker is aimed to land 0.4 m behind the stumps, so it reaches the bat and the stumps on the full. Aimed as the showcase is and flown at any speed and swing in the envelope with up to 3 m/s of wind along the pitch, it passes the popping crease below 0.45 m and hits the bottom 0.2 m of the stumps. Across the same range the bouncer lands 9.5 to 11.0 m from release (the C++ tests check both).

The outcome model is unchanged, because calibration depends on it, and it treats these lengths as follows:

- A played delivery is classified only by the sideways gap between where the ball arrives at the bat plane and where the batter expected it. Its height plays no part. A bouncer passing at chest height is middled if it is where the batter expected, and scores the venue's runs when middled.
- The batter commits one reaction time (0.2 s) before arrival and expects mean swing and no seam deviation from there. A yorker never bounces and a bouncer bounces before the commit point, so neither surprises the batter with seam deviation or bounce height. Only swing that differs from the mean, over the last 0.2 s, can open a gap. At 135 km/h, ball age 1, both are middled 98 to 100% of the time when played, against 64 to 73% for good length.
- When left, a bouncer is bowled only if it comes in below the top of the stumps. It arrives at 0.8 to 1.1 m, so leaving it almost never costs a wicket. A yorker left is bowled when it is in line.
- There is no lbw, no hit wicket and no second bounce in the model. The bouncer's danger to the batter is not represented.

## Consequences

- Same flags as the native build where they matter: `-std=c++20 -O3 -ffp-contract=off`, no fast-math, warnings as errors.
- The header changes are additive. `simulate_batch` takes an optional `first_index` (default 0), which numbers the batch's deliveries from there. A test splits a batch at arbitrary boundaries and gets the same bits as one call. The output of every existing call is unchanged bit for bit: a hash of 600,000 deliveries and six traces through the Python binding is the same before and after, and the error bound is still 5.30 mm.
- Nothing is allocated, at start-up or per run. Each instance simulates its pieces 4,096 deliveries at a time in static buffers, about 0.6 MiB of linear memory in all. The module links with `-sMALLOC=none` and no heap, so a call to `malloc` anywhere would fail the build. A batch may hold up to 1,000,000 deliveries.
- The result of a run is identical for any number of workers and any split. Counts are integers and the summary is computed once from their sum; arrivals are placed by delivery index. Node tests merge chunked calls and run pools of 1, 3 and 4 `worker_threads` against one instance.
- Inputs are validated in `live.cpp` against the envelope constants in `fourth_stump_envelope.hpp`: speed 120 to 150 km/h, mean swing within ±0.30, wind speed at most 5 m/s, release position within the swept ranges, a named length. The engine does not run outside it: `engine-wasm.js` checks the inputs on the page's instance before any worker starts and rejects with a `RangeError` naming the input. Because the envelope bounds wind speed, wind along the pitch narrows the crosswind allowed; live.json gives each venue's `max_crosswind`.
- `engine.limits` and `engine.lengths` are read from the header's constants through the module, so the page's controls cannot drift from the engine.
- `sample` gives one delivery of the batch: the same draws as delivery `index` of `run` with the same arguments, its path, and its outcome in the vocabulary of `fan_outcomes`. Whether a carrying edge is caught is drawn from the delivery's own stream 2 (stream 1 samples releases).
- The seed is a 32-bit integer at this boundary.
- The showcase release moved to x = ±0.75 m, z = 2.08 m (right-arm over, left-arm over its mirror). It is defined in the exporter. The calibration population keeps its own release in `release_spec_for`, so `data/*.json` did not change. At ball age 1 the published dismissal probabilities moved by up to 0.013 where the mean delivery reaches the stumps (Perth and Newlands, bowling into the crosswind), and by less than 0.003 elsewhere. Expected values moved by up to 0.51 runs. No scenario's better action changed.
- `node --test viz/tests/engine-wasm.test.mjs` runs in CI against the committed build. Rebuilding it needs Emscripten (`source emsdk_env.sh`, then `make wasm`); the build is reproducible byte for byte on one Emscripten version (7.0.1).

## Measured speed

50,000 deliveries of the showcase release at 135 km/h, good length, in a visible Chromium 158 window on the README's i5-13450HX (16 logical cores), 27 November 2026. Each run used a freshly loaded page. Figures are the median of 21 runs after 20 warm-up runs, as the range over two sessions, with the first run after loading in brackets. "0" is the single in-page instance. `performance.now()` is coarsened to 0.1 ms on a page without cross-origin isolation.

| Workers | Lord's (wind across only), ms | Newlands (wind (4, 1) m/s), ms | Pool start-up, ms |
|---|---|---|---|
| 0 (in page) | 18.0 (first 19 to 23) | 28.1 (28) | 9 to 12 |
| 1 | 18.1 to 18.5 (19) | 28.0 to 28.3 (28 to 29) | 17 to 18 |
| 2 | 9.3 to 9.6 (12 to 16) | 14.5 to 14.8 (14 to 15) | 23 |
| 4 | 4.8 to 5.3 (6 to 9) | 7.4 to 8.2 (7 to 8) | 31 to 41 |
| 8 | 3.1 to 3.3 (4) | 4.6 to 5.0 (5) | 51 to 53 |
| 16 (the default here) | 2.3 to 2.6 (3) | 3.0 to 3.4 (3 to 4) | 93 to 116 |

The hoped-for 2 ms was not reached. The best median is 2.3 ms at Lord's, 15% over, and 3.0 ms at Newlands, 50% over, where wind along the pitch switches on the Newton steps in `to_plane`. One instance runs at 360 to 380 ns per delivery, within 10 to 15% of one native thread built with `-march=native` (342 ns per delivery in calm air and 549 ns in wind (4, 1) m/s, `make bench`). Four workers scale almost perfectly. Beyond eight workers, the efficiency cores and hyper-threads add less. The default pool is one worker per logical core, at most 16: the page's own thread only waits during a run. Node 24 runs one instance at the same speed as the page: 18.8 to 19.9 ms and 29.3 to 31.6 ms. Headless Chromium started from a background shell ran about five times slower; that looks like the Windows power throttling the README describes, so the figures above come from a visible window.

## What the cross-platform check showed

ADR-003 promises statistical agreement across platforms. For each venue and arm at ball age 1, end 0, 50,000 WebAssembly deliveries with seed 1 were compared with the 200,000 native deliveries (seed 2026) behind each probability in trajectories.json. The tolerance is four standard errors of the difference of two independent estimates, 4 √(p (1 − p) (1/50,000 + 1/200,000)), plus the 5 × 10⁻⁶ the published figures are rounded to. All 30 probabilities passed; the largest difference was 1.9 standard errors (Perth, right-arm, dismissal when leaving). The mean delivery's path matched the published one to its four-decimal rounding.

With the same seed the agreement is closer than the contract asks. 100,000 deliveries with seed 2026 in WebAssembly and through the native Python binding gave identical outcome counts in all six venue and arm cases. Of 3,072 arrival coordinates compared, 3,046 were bit-identical and the rest differed by at most 3.4 × 10⁻¹⁴ m, the last bits of `exp`, `log`, `sin` and `cos` in two maths libraries. The promise stays statistical, because a delivery that lands within that distance of a stump or the edge of the bat could still be classified differently.

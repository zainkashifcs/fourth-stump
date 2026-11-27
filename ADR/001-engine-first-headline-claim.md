# Engine-first headline claim

The project could lead with the engine, the calibrated model, or the 3D demo, and one build cycle cannot make all three deep. We lead with the engine: a deterministic, zero-allocation C++20 Monte Carlo engine simulating N million deliveries per second, whose closed-form kernel is checked against an RK4 reference to a stated error bound. This is the claim a Quant Dev interviewer hires on, and it is the one we can defend with tests and benchmarks.

## Considered options

- **Model-first** ("unobserved venue physics recovered from selection-biased data"): rejected as the headline. It is a quant-researcher pitch, and a few parameters per venue fitted from commentary text will not survive identifiability questions.
- **Demo-first** (the 3D mini-game): rejected. It shows polish, not the skills the role tests.

## Consequences

- Build order and cut order follow from the claim: engine and physics, then run-expectancy DP and calibrator, then scraper, then viz. When time runs out, work is cut from the end of that list.
- Every cycle is gated on two checks: kernel error against the RK4 reference, and the throughput benchmark.
- Calibration and the DP are presented as the reason the engine matters, not as independent research results.
- Viz consumes a fixed trajectory schema and never reaches into engine internals. It is built in the browser with no Blender dependency; models are procedural.

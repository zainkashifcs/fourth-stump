# Caller-owned batch buffers, a non-allocating engine, and a full-pipeline benchmark

The engine is one header exposing `simulate_batch`. The caller owns 64-byte-aligned structure-of-arrays buffers for releases and outcomes; the engine writes each delivery's outcome to its own index and never allocates. We chose caller-owned buffers over an engine that returns results so the zero-allocation claim is a property a test can assert, not a habit.

Coordinates are right-handed with the origin at the base of the batter's middle stump: `+x` is the off side of a right-hander, `+y` points up the pitch towards the bowler (bowler's stumps at 20.12 m), `+z` is up. A delivery travels in `−y`. The off stump is at `x = +0.1143 m`, the bails at `z = 0.711 m`, and the fourth-stump corridor is `x ∈ [+0.18, +0.28] m`.

## Consequences

- A test replaces global `operator new` and asserts zero calls inside a batch. This does not see `malloc` calls made by the OpenMP runtime when it first creates its threads; the test warms the runtime up first and the README states the limit.
- The benchmark times the full pipeline per delivery: random draws, both flight legs, the bounce, the batter's expected arrival, and both actions. It reports median nanoseconds per delivery on 1 and 16 threads across batch sizes, and the speed-up over the RK4 reference.
- The speed-up over RK4 is quoted at equal accuracy: against RK4 at the coarsest step whose error, on the same deliveries, is no larger than the kernel's. Comparing with a finely stepped RK4 would credit the kernel for accuracy it does not have.
- The benchmark reports calm conditions and a windy venue separately, because wind along the pitch switches on the Newton steps below and costs throughput.
- The engine does not validate its inputs. The Python binding is the trust boundary and rejects releases that are not finite, start at or below the pitch, or do not travel down it.
- Along-pitch wind makes the arrival distance the root of a Lambert-W-type equation. The kernel solves it with a fixed number of Newton steps, so it stays O(1) but is no longer a single `exp` when wind blows along the pitch.
- Tests use vendored Catch2. OpenMP is optional at compile time so the header can later build under Emscripten; no WebAssembly build exists yet.
- The Python binding and the visualisation export are thin callers of the same header.

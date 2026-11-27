# Determinism contract: bit-reproducible across thread counts, statistical across platforms

"Deterministic" in the headline claim needs a boundary. We promise that one binary, given one seed, produces bit-identical results on 1, 4 and 16 threads under any OpenMP schedule. Across platforms and compilers we promise only agreement within a stated statistical tolerance. The stronger cross-platform guarantee would cost the `-march=native` build that the throughput claim depends on.

## Considered options

- **Bit-identical on any machine and compiler**: rejected. It requires dropping `-march=native` from the checked build, pinning floating-point contraction, and replacing the platform maths library, whose `exp`, `log` and `sin` can differ in the last bit between Windows and Linux.
- **One random stream per thread**: rejected. Results would change with the thread count.

## Consequences

- Each delivery's random stream is a function of the seed and its delivery index only, never of the thread that runs it. Default: xoshiro256** with its state mixed from (seed, delivery index); a counter-based generator such as Philox is the fallback if per-delivery seeding shows up in the benchmark.
- Per-delivery streams are required, not just convenient: Ziggurat sampling rejects, so deliveries consume a varying number of draws and a shared stream would drift.
- Reduction order is fixed. Per-delivery outcomes are written to their own index; counts are integers; any floating-point total is summed in an order that does not depend on the thread count.
- `-ffast-math` and any flag that implies it are banned from every build.
- Every build uses `-ffp-contract=off`. With `-march=native` the compiler may otherwise fuse a multiply and an add differently in different callers of the same inline kernel, and one delivery could then give different bits in a batch and in a single trace.
- A test asserts bit-identical batch output on 1, 4 and 16 threads. Linux CI compares against stored results within the stated tolerance, not bit for bit.
- The README states the boundary in these words: bit-reproducible across thread counts, statistically reproducible across platforms.

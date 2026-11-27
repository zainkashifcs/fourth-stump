# A second random-number policy: Philox4x32-10 with branchless Box-Muller, chosen at compile time

`simulate_batch` takes the random-number policy as a template parameter. The default, `XoshiroZiggurat`, is the xoshiro256** stream seeded per delivery with Ziggurat normals (ADR-003), and its output is bit-identical to what it was before the parameter existed, because calibration results and a committed data file depend on it. The second policy, `PhiloxBoxMuller`, keys Philox4x32-10 with the seed and puts the delivery index in the counter (word 2 numbers the 128-bit blocks a delivery draws, 0 for the three physics draws). It turns the four output words into normals with Box-Muller: three are used, one is discarded. It has no rejection, so every delivery costs the same operations. Both policies draw a block of 64 deliveries into fixed-size, 64-byte-aligned arrays on the thread's stack, then run the kernel over the block. For Philox the draw loop is a `#pragma omp simd` loop.

This is the counter-based fallback ADR-003 anticipated. The measured result is that it is not faster in any way that matters. The draws are about 4% of a delivery's cost, and the two policies come out within 3% of each other on the full pipeline.

## Considered options

- **Replace the default with Philox**: rejected. It would change every calibrated number and the committed data file for no measured gain.
- **Box-Muller on the standard library's `log`, `sin` and `cos`**: kept out. The loop does not vectorise: there is no vector maths library on this toolchain (g++ 16.2, MinGW UCRT), and `std::sqrt`'s errno branch adds control flow. In a rough, unpinned early measurement it also cost about three times as much per delivery as the Ziggurat.
- **Polynomial `log` and `sincos` without range checks**: chosen. `log_branchless` reduces to a mantissa in [√2/2, √2] and sums 2 atanh(s) as a Taylor series to s¹⁹. `sincos_2pi_unit32` takes the nearest quarter turn from the 32-bit word itself, which leaves an exact remainder with |a| ≤ π/4, and uses Taylor series to a¹⁷ and a¹⁸. Tested against the standard library over every 4,099th 32-bit input plus both ends, the quarter turns and the powers of two: log relative error ≤ 2.2 × 10⁻¹⁶ (asserted ≤ 2⁻⁵²); sin and cos absolute error ≤ 6.9 × 10⁻¹⁶ (asserted ≤ 10⁻¹⁵), most of which is the rounding of 2πu inside the reference itself.
- **Intrinsics or GCC vector extensions for Philox**: rejected. They tie the header to x86, and Emscripten is still a target (ADR-012).
- **`-ffast-math`, `-fno-math-errno` or a vector maths library**: rejected by ADR-003, and the Makefile's flags stay as they are.

## What vectorises (`-fopt-info-vec`, AVX2 on an i5-13450HX, `-ffp-contract=off`)

- **The Philox generator**: it vectorises ("loop vectorized using 32 byte vectors") but gains nothing. AVX2 has no 32×32→64 multiply on all eight 32-bit lanes, so GCC widens and narrows every round with shuffles. Pinned to one performance core, Philox costs 8.5 ns per delivery vectorised against 8.0 ns scalar.
- **The polynomial transform**: it vectorises, and pays off: 23.6 ns scalar against 7.0 ns vectorised per delivery (two logs, two sincos, two square roots).
- **The whole Philox draw**: 34.0 ns scalar, 15.2 ns vectorised. The xoshiro256** + Ziggurat draw costs 14.4 ns on the same core (means of two runs, 27 November 2026, a browser and a game open, power throttling opted out). In the interleaved `make bench` comparison, unpinned and the median of three runs, the Philox draws came out 7% cheaper (14.1 against 15.1 ns per delivery), and the full pipeline 0 to 2% faster.
- **The Ziggurat draw loop**: it does not vectorise and is not asked to (rejection loops). The per-delivery kernel does not vectorise either.
- **Getting there took four source-level changes, none of them flag changes.** Every select is on integer bits or a 0/1 weight, because under the default `-ftrapping-math` GCC will not if-convert a conditional floating-point operation. `std::sqrt(std::fabs(x))` lets GCC's float range analysis drop the errno branch, and it gives the same bits for x > 0. The quarter turn is computed in 64-bit integers, because AVX2 has no packed double-to-int64 conversion. The `Conditions` are copied to a local so their loads hoist out of the loop.
- **Vector lanes and scalar code give the same bits.** A test checks every draw from the vectorised block against the same delivery computed on its own. Elementwise IEEE operations without contraction round identically in either form.

## Consequences

- `simulate_batch<PhiloxBoxMuller>(in, c, seed, out)` selects the new policy. Existing calls, `fs::draw` and `Rng` are unchanged. Tests assert the Random123 known-answer vectors, moments and tails of 6,000,000 normals, bit-identical batches on 1, 4 and 16 threads, zero allocation, block and batch-size independence, and agreement of outcome rates with the default policy within five standard errors at four venues.
- A Philox normal truncates at about 6.7σ, because the log's argument is a 32-bit uniform. That is immaterial at these sample sizes.
- Parallel work is handed out in blocks of 64 deliveries, so a batch smaller than 64 × threads uses fewer threads. The threshold is 1,024 deliveries at 16 threads. Thread boundaries now fall on 64-delivery multiples, which are whole cache lines in every outcome array of an aligned `BatchStorage`.
- The polynomial kernels use only IEEE arithmetic, so a Philox delivery's draws do not depend on the platform's maths library. The kernel still calls `exp` and `log`, so the cross-platform promise in ADR-003 stays statistical.
- On a CPU with AVX-512 (a full 32×32→64 multiply on more lanes, packed int64 conversions) the generator may start to pay. Rerun `make bench`; the policy table reports both policies side by side.

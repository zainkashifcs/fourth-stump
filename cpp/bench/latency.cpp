// Tail-latency benchmark. Times single simulate_batch calls, one sample per call, and
// prints percentiles of the wall time per batch. Then measures what false sharing between
// per-thread counters costs on this machine. Prints markdown tables, with everything a
// rerun needs to stand alone: thread counts, batch sizes, sample counts, compiler, clock.
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "fourth_stump_engine.hpp"
#include "power_throttling.hpp"

namespace {

using namespace fs;
using Clock = std::chrono::steady_clock;

void set_threads(int n) {
#ifdef _OPENMP
    omp_set_num_threads(n);
#else
    (void)n;
#endif
}

int max_threads() {
#ifdef _OPENMP
    return omp_get_max_threads();
#else
    return 1;
#endif
}

int procs() {
#ifdef _OPENMP
    return omp_get_num_procs();
#else
    return 1;
#endif
}

// Nearest-rank percentile on the sorted samples: the smallest sample with at least
// p per mille of all samples at or below it, sorted[ceil(p N / 1000) - 1]. No interpolation,
// so with fewer than 1000 samples p99.9 is the maximum.
std::int64_t percentile(const std::vector<std::int64_t>& sorted, std::size_t per_mille) {
    const std::size_t rank = std::max<std::size_t>(1, (per_mille * sorted.size() + 999) / 1000);
    return sorted[rank - 1];
}

void latency_row(std::size_t n, int threads, int samples, int warmup, const Conditions& c) {
    BatchStorage batch(n);  // every buffer is allocated here, outside the timed region
    batch.sample(ReleaseSpec{}, c, 99);
    OutcomeBatch out = batch.outcomes();
    const ReleaseBatch in = batch.releases();
    std::vector<std::int64_t> ns(static_cast<std::size_t>(samples));
    set_threads(threads);
    for (int r = 0; r < warmup; ++r) simulate_batch(in, c, 1'000'000 + static_cast<std::uint64_t>(r), out);
    for (int r = 0; r < samples; ++r) {
        const auto t0 = Clock::now();
        simulate_batch(in, c, static_cast<std::uint64_t>(r), out);
        const auto t1 = Clock::now();
        ns[static_cast<std::size_t>(r)] = std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count();
    }
    std::sort(ns.begin(), ns.end());
    const std::int64_t p50 = percentile(ns, 500), p99 = percentile(ns, 990), p999 = percentile(ns, 999);
    const double per = static_cast<double>(n);
    std::printf("| %zu | %d | %d | %d | %lld | %lld | %lld | %lld | %lld | %.1f | %.1f | %.1f |\n", n, max_threads(), samples,
                warmup, static_cast<long long>(p50), static_cast<long long>(p99), static_cast<long long>(p999),
                static_cast<long long>(ns.front()), static_cast<long long>(ns.back()), static_cast<double>(p50) / per,
                static_cast<double>(p99) / per, static_cast<double>(p999) / per);
}

// ---- False sharing ------------------------------------------------------------------------
// One counting workload, two layouts of the per-thread slots: plain Summary back to back
// (56 bytes, so neighbouring threads' slots share 64-byte lines) and PaddedSummary (a line
// per thread). Every count is a read-modify-write on the shared slot array, which is what
// makes the layout matter; a counter kept in a register would hide it.
constexpr int kMaxSlots = 64;
alignas(64) Summary g_packed[kMaxSlots];
alignas(64) PaddedSummary g_padded[kMaxSlots];

Summary& slot(Summary* slots, int t) { return slots[t]; }
Summary& slot(PaddedSummary* slots, int t) { return slots[t].s; }

template <typename Slot>
Summary count_once(std::span<const std::uint8_t> leave, std::span<const std::uint8_t> play, int threads, Slot* slots) {
    for (int t = 0; t < threads; ++t) slot(slots, t) = Summary{};
    const auto n = static_cast<std::ptrdiff_t>(leave.size());
#ifdef _OPENMP
#pragma omp parallel num_threads(threads)
#endif
    {
#ifdef _OPENMP
        Summary& mine = slot(slots, omp_get_thread_num());
#pragma omp for schedule(static)
#else
        Summary& mine = slot(slots, 0);
#endif
        for (std::ptrdiff_t k = 0; k < n; ++k) {
            const auto i = static_cast<std::size_t>(k);
            ++mine.n;
            mine.leave_bowled += leave[i];
            ++mine.play[play[i]];
        }
    }
    Summary total;  // integer sums in thread order: the same totals for any thread count
    for (int t = 0; t < threads; ++t) {
        const Summary& s = slot(slots, t);
        total.n += s.n;
        total.leave_bowled += s.leave_bowled;
        for (std::size_t p = 0; p < total.play.size(); ++p) total.play[p] += s.play[p];
    }
    return total;
}

bool same(const Summary& a, const Summary& b) { return a.n == b.n && a.leave_bowled == b.leave_bowled && a.play == b.play; }

// Median nanoseconds per delivery over `reps` timed calls of `run`.
template <typename F>
double median_ns_per_delivery(int reps, std::size_t n, F&& run) {
    std::vector<double> t(static_cast<std::size_t>(reps));
    for (auto& v : t) {
        const auto t0 = Clock::now();
        run();
        v = std::chrono::duration<double, std::nano>(Clock::now() - t0).count() / static_cast<double>(n);
    }
    std::sort(t.begin(), t.end());
    return t[t.size() / 2];
}

}  // namespace

int main() {
    fs::bench::opt_out_of_power_throttling();
    std::printf("# Latency of one simulate_batch call\n\n");
    const Conditions calm;
    const int many = 16;
#ifdef __VERSION__
    std::printf("Compiler: %s. ", __VERSION__);
#endif
    std::printf("Logical processors: %d. Clock: steady_clock, period %.0f ns. Conditions: no wind, seed = sample index.\n",
                procs(), 1e9 * Clock::period::num / Clock::period::den);
    for (const char* var : {"OMP_WAIT_POLICY", "OMP_PROC_BIND", "OMP_PLACES", "GOMP_SPINCOUNT"}) {
        const char* v = std::getenv(var);
        std::printf("%s=%s. ", var, v ? v : "(unset)");
    }
    std::printf("\nEach sample is one call, timed alone, after the warm-up calls. Percentiles are nearest-rank on the "
                "sorted samples (no interpolation); with fewer than 1000 samples p99.9 is the maximum.\n\n");
    std::printf("| Batch size | Threads | Samples | Warm-up calls | p50 ns | p99 ns | p99.9 ns | Min ns | Max ns "
                "| p50 ns per delivery | p99 ns per delivery | p99.9 ns per delivery |\n"
                "|---|---|---|---|---|---|---|---|---|---|---|---|\n");
    for (int t : {1, many}) {
        latency_row(10'000, t, 3'000, 300, calm);
        latency_row(100'000, t, 500, 50, calm);
    }

    // Outcomes of one real batch are the counting input.
    const std::size_t n = std::size_t{1} << 22;
    BatchStorage batch(n);
    batch.sample(ReleaseSpec{}, calm, 99);
    OutcomeBatch out = batch.outcomes();
    set_threads(many);
    simulate_batch(batch.releases(), calm, 7, out);
    const auto leave = batch.leave.span(), play = batch.play.span();
    const Summary want = summarize(leave, play);
    const int reps = 21;

    std::printf("\n# False sharing between per-thread counters\n\n%zu deliveries per pass, median of %d passes. "
                "sizeof(Summary) = %zu, sizeof(PaddedSummary) = %zu, alignof(PaddedSummary) = %zu.\n\n",
                n, reps, sizeof(Summary), sizeof(PaddedSummary), alignof(PaddedSummary));
    std::printf("| Counting path | Threads | Median ns per delivery |\n|---|---|---|\n");
    bool ok = true;
    for (int t : {1, many}) {
        Summary got;
        const double packed = median_ns_per_delivery(reps, n, [&] { got = count_once(leave, play, t, g_packed); });
        ok = ok && same(got, want);
        const double padded = median_ns_per_delivery(reps, n, [&] { got = count_once(leave, play, t, g_padded); });
        ok = ok && same(got, want);
        std::printf("| Per-thread Summary, packed (56-byte slots) | %d | %.3f |\n", t, packed);
        std::printf("| Per-thread PaddedSummary (64-byte slots) | %d | %.3f |\n", t, padded);
    }
    Summary got;
    const double engine = median_ns_per_delivery(reps, n, [&] { got = summarize(leave, play); });
    ok = ok && same(got, want);
    std::printf("| Engine's summarize (serial, one Summary) | 1 | %.3f |\n", engine);
    if (!ok) {
        std::fprintf(stderr, "counting paths disagree with summarize\n");
        return 1;
    }
    return 0;
}

// Throughput benchmark (ADR-012). Times the full pipeline per delivery: random draws,
// both flight legs, the bounce, the batter's expected arrival and both actions.
// Prints markdown tables.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <initializer_list>
#include <vector>

#include "fourth_stump_envelope.hpp"

namespace {

using Clock = std::chrono::steady_clock;

template <typename F>
double median_seconds(int reps, F&& run) {
    std::vector<double> times;
    for (int r = 0; r < reps; ++r) {
        const auto t0 = Clock::now();
        run(r);
        times.push_back(std::chrono::duration<double>(Clock::now() - t0).count());
    }
    std::nth_element(times.begin(), times.begin() + reps / 2, times.end());
    return times[static_cast<std::size_t>(reps / 2)];
}

int max_threads() {
#ifdef _OPENMP
    return omp_get_num_procs();
#else
    return 1;
#endif
}

void set_threads(int n) {
#ifdef _OPENMP
    omp_set_num_threads(n);
#else
    (void)n;
#endif
}

}  // namespace

int main() {
    using namespace fs;
    const Conditions c;
    const int threads = max_threads();

    std::printf("| Batch size | Threads | Median ns per delivery | Million deliveries per second |\n|---|---|---|---|\n");
    for (std::size_t n : {std::size_t{1} << 12, std::size_t{1} << 16, std::size_t{1} << 20, std::size_t{1} << 22}) {
        BatchStorage batch(n);
        batch.sample(ReleaseSpec{}, c, 99);
        OutcomeBatch out = batch.outcomes();
        for (int t : {1, threads}) {
            set_threads(t);
            const int inner = static_cast<int>(std::max<std::size_t>(1, (std::size_t{1} << 20) / n));
            simulate_batch(batch.releases(), c, 0, out);  // warm up
            const double sec = median_seconds(9, [&](int r) {
                for (int k = 0; k < inner; ++k) simulate_batch(batch.releases(), c, static_cast<std::uint64_t>(r * inner + k), out);
            });
            const double ns = 1e9 * sec / (static_cast<double>(n) * inner);
            std::printf("| %zu | %d | %.1f | %.1f |\n", n, t, ns, 1e3 / ns);
            if (threads == 1) break;
        }
    }

    // Trajectory only, one thread: the kernel against the RK4 reference on the same deliveries.
    const std::size_t n = 20'000;
    BatchStorage batch(n);
    batch.sample(ReleaseSpec{}, c, 99);
    double sink = 0.0;
    const Pitch pitch = pitch_of(c);
    const auto release = [&](std::size_t i) {
        return Release{batch.x.span()[i], batch.z.span()[i], batch.vx.span()[i], batch.vy.span()[i], batch.vz.span()[i]};
    };
    const double kernel = median_seconds(9, [&](int) {
        for (std::size_t i = 0; i < n; ++i) {
            const Flight f = make_flight(release_state(release(i)), c.cs_mean, 0.01, c, pitch);
            sink += f.at(c.release_y - kBatPlaneY).x + f.at(c.release_y).z;
        }
    });
    std::printf("\n| Trajectory method | ns per delivery | Speed-up over RK4 at 1 ms |\n|---|---|---|\n");
    double rk4_1ms = 0.0;
    for (double dt : {1e-3, 1e-4}) {
        const double sec = median_seconds(5, [&](int) {
            for (std::size_t i = 0; i < n; ++i) {
                const reference::Path p = reference::fly(release(i), c.cs_mean, 0.01, c, dt);
                sink += p.bat.x + p.stumps.z;
            }
        });
        if (dt == 1e-3) rk4_1ms = sec;
        std::printf("| RK4 reference, %.1f ms step | %.0f | %.2fx |\n", 1e3 * dt, 1e9 * sec / static_cast<double>(n), rk4_1ms / sec);
    }
    std::printf("| Closed-form kernel | %.0f | %.0fx |\n", 1e9 * kernel / static_cast<double>(n), rk4_1ms / kernel);
    std::fprintf(stderr, "checksum %.6f\n", sink);
    return 0;
}

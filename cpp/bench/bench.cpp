// Throughput benchmark (ADR-012). Times the full pipeline per delivery: random draws,
// both flight legs, the bounce, the batter's expected arrival and both actions.
// Prints markdown tables.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <initializer_list>
#include <utility>
#include <vector>

#include "fourth_stump_envelope.hpp"
#include "power_throttling.hpp"

namespace {

using namespace fs;
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

// Median nanoseconds per delivery for simulate_batch at one batch size and thread count.
double pipeline_ns(std::size_t n, int threads, const Conditions& c) {
    BatchStorage batch(n);
    batch.sample(ReleaseSpec{}, c, 99);
    OutcomeBatch out = batch.outcomes();
    set_threads(threads);
    const int inner = static_cast<int>(std::max<std::size_t>(1, (std::size_t{1} << 20) / n));
    simulate_batch(batch.releases(), c, 0, out);  // warm up
    const double sec = median_seconds(9, [&](int r) {
        for (int k = 0; k < inner; ++k) simulate_batch(batch.releases(), c, static_cast<std::uint64_t>(r * inner + k), out);
    });
    return 1e9 * sec / (static_cast<double>(n) * inner);
}

// ---- The two random-number policies (ADR-014) ----------------------------------------------
// Each repetition times both policies back to back, and the order swaps every repetition, so a
// change in clock speed or load during the run hits both alike. Returns each one's median seconds.
template <typename A, typename B>
std::pair<double, double> interleaved_medians(int reps, A&& a, B&& b) {
    std::vector<double> ta, tb;
    const auto time = [](auto& run, int r, std::vector<double>& into) {
        const auto t0 = Clock::now();
        run(r);
        into.push_back(std::chrono::duration<double>(Clock::now() - t0).count());
    };
    for (int r = 0; r < reps; ++r) {
        if (r % 2 == 0) time(a, r, ta), time(b, r, tb);
        else time(b, r, tb), time(a, r, ta);
    }
    const auto median = [](std::vector<double>& v) {
        std::nth_element(v.begin(), v.begin() + static_cast<std::ptrdiff_t>(v.size() / 2), v.end());
        return v[v.size() / 2];
    };
    return {median(ta), median(tb)};
}

// Both policies on the full pipeline, same releases, same thread count.
std::pair<double, double> policy_pipeline_ns(std::size_t n, int threads, const Conditions& c) {
    BatchStorage batch(n);
    batch.sample(ReleaseSpec{}, c, 99);
    OutcomeBatch out = batch.outcomes();
    set_threads(threads);
    simulate_batch<XoshiroZiggurat>(batch.releases(), c, 0, out);  // warm up both
    simulate_batch<PhiloxBoxMuller>(batch.releases(), c, 0, out);
    const auto run = [&](auto policy) {
        return [&, policy](int r) {
            for (int k = 0; k < 4; ++k)
                simulate_batch<decltype(policy)>(batch.releases(), c, static_cast<std::uint64_t>(4 * r + k), out);
        };
    };
    const auto [zig, phi] = interleaved_medians(11, run(XoshiroZiggurat{}), run(PhiloxBoxMuller{}));
    const double per = 1e9 / (4.0 * static_cast<double>(n));
    return {zig * per, phi * per};
}

// Both policies' random draws alone (three normals per delivery), one thread, drawn block by
// block as simulate_batch draws them.
std::pair<double, double> policy_draws_ns(const Conditions& c, double& sink) {
    const std::size_t n = std::size_t{1} << 20;
    DrawBlock b;
    const auto run = [&](auto policy) {
        return [&, policy](int r) {
            for (std::size_t first = 0; first < n; first += kDrawBlock) {
                draw_block<decltype(policy)>(static_cast<std::uint64_t>(r), first, kDrawBlock, c, b);
                sink += b.cs[3] + b.e_z[7];
            }
        };
    };
    const auto [zig, phi] = interleaved_medians(21, run(XoshiroZiggurat{}), run(PhiloxBoxMuller{}));
    return {1e9 * zig / static_cast<double>(n), 1e9 * phi / static_cast<double>(n)};
}

void policy_table(const Conditions& calm, const Conditions& windy, std::initializer_list<int> thread_counts) {
    std::printf("\n%zu deliveries per batch; the two policies alternate repetition by repetition.\n\n"
                "| Conditions | Threads | xoshiro256** + Ziggurat, ns per delivery | Philox4x32-10 + Box-Muller, ns per "
                "delivery | Philox / xoshiro | Million deliveries per second (xoshiro, Philox) |\n|---|---|---|---|---|---|\n",
                std::size_t{1} << 20);
    for (const auto& [name, c] : {std::pair{"No wind", calm}, std::pair{"Wind (4, 1) m/s", windy}})
        for (int t : thread_counts) {
            const auto [zig, phi] = policy_pipeline_ns(std::size_t{1} << 20, t, c);
            std::printf("| %s | %d | %.1f | %.1f | %.2f | %.1f, %.1f |\n", name, t, zig, phi, phi / zig, 1e3 / zig, 1e3 / phi);
        }
    set_threads(1);
    double sink = 0.0;
    const auto [zig, phi] = policy_draws_ns(calm, sink);
    std::printf("\n| Draws alone, 1 thread | xoshiro256** + Ziggurat | Philox4x32-10 + Box-Muller | Philox / xoshiro |\n"
                "|---|---|---|---|\n");
    std::printf("| ns per delivery (3 normals) | %.1f | %.1f | %.2f |\n", zig, phi, phi / zig);
    std::printf("| ns per normal | %.2f | %.2f | %.2f |\n", zig / 3.0, phi / 3.0, phi / zig);
    std::fprintf(stderr, "draws checksum %.6f\n", sink);
}

}  // namespace

int main() {
    fs::bench::opt_out_of_power_throttling();
    const Conditions calm;
    Conditions windy;  // wind along the pitch switches on the kernel's Newton steps (ADR-012)
    windy.wind_x = 4.0;
    windy.wind_y = 1.0;
    const int threads = max_threads();
    const std::initializer_list<int> thread_counts = {1, threads};

    std::printf("| Conditions | Batch size | Threads | Median ns per delivery | Million deliveries per second |\n|---|---|---|---|---|\n");
    for (std::size_t n : {std::size_t{1} << 12, std::size_t{1} << 16, std::size_t{1} << 20, std::size_t{1} << 22})
        for (int t : thread_counts) {
            const double ns = pipeline_ns(n, t, calm);
            std::printf("| No wind | %zu | %d | %.1f | %.1f |\n", n, t, ns, 1e3 / ns);
        }
    for (int t : thread_counts) {
        const double ns = pipeline_ns(std::size_t{1} << 20, t, windy);
        std::printf("| Wind (4, 1) m/s | %d | %d | %.1f | %.1f |\n", 1 << 20, t, ns, 1e3 / ns);
    }
    policy_table(calm, windy, thread_counts);

    // Trajectory only, one thread, same deliveries: the kernel against RK4 at several
    // step sizes, each with its worst error against a converged reference (RK4 at
    // 0.01 ms). The fair comparison is RK4 at the coarsest step that is at least as
    // accurate as the kernel.
    set_threads(1);
    const std::size_t n = 4'000;
    BatchStorage batch(n);
    batch.sample(ReleaseSpec{}, windy, 99);
    const Pitch pitch = pitch_of(windy);
    const double s_bat = windy.release_y - kBatPlaneY;
    const auto release = [&](std::size_t i) {
        return Release{batch.x.span()[i], batch.z.span()[i], batch.vx.span()[i], batch.vy.span()[i], batch.vz.span()[i]};
    };
    const double seam = 0.01;
    std::vector<reference::Path> truth(n);
    for (std::size_t i = 0; i < n; ++i) truth[i] = reference::fly(release(i), windy.cs_mean, seam, windy, 1e-5);
    const auto worst = [&](auto&& arrival) {
        double w = 0.0;
        for (std::size_t i = 0; i < n; ++i) {
            const auto [bat, stumps] = arrival(i);
            w = std::max({w, envelope::distance(bat, truth[i].bat), envelope::distance(stumps, truth[i].stumps)});
        }
        return w;
    };
    double sink = 0.0;

    const auto kernel_arrival = [&](std::size_t i) {
        const Flight f = make_flight(release_state(release(i)), windy.cs_mean, seam, windy, pitch);
        return std::pair{f.at(s_bat), f.at(windy.release_y)};
    };
    const double kernel_sec = median_seconds(9, [&](int) {
        for (std::size_t i = 0; i < n; ++i) sink += kernel_arrival(i).first.x;
    });
    const double kernel_error = worst(kernel_arrival);

    std::printf("\n| Trajectory method | ns per delivery | Worst error on these deliveries (mm) | Kernel speed-up |\n|---|---|---|---|\n");
    std::printf("| Closed-form kernel | %.0f | %.3f | 1x |\n", 1e9 * kernel_sec / static_cast<double>(n), 1e3 * kernel_error);
    double fair_speedup = 0.0, fair_dt = 0.0;
    for (double dt : {20e-3, 10e-3, 5e-3, 2e-3, 1e-3, 1e-4}) {
        const auto rk4_arrival = [&](std::size_t i) {
            const reference::Path p = reference::fly(release(i), windy.cs_mean, seam, windy, dt);
            return std::pair{p.bat, p.stumps};
        };
        const double sec = median_seconds(5, [&](int) {
            for (std::size_t i = 0; i < n; ++i) sink += rk4_arrival(i).first.x;
        });
        const double error = worst(rk4_arrival);
        std::printf("| RK4, %.1f ms step | %.0f | %.3f | %.0fx |\n", 1e3 * dt, 1e9 * sec / static_cast<double>(n), 1e3 * error,
                    sec / kernel_sec);
        if (fair_dt == 0.0 && error <= kernel_error) fair_dt = dt, fair_speedup = sec / kernel_sec;
    }
    std::printf("\nEqual-accuracy comparison: RK4 needs a %.1f ms step to match the kernel's error on these deliveries; "
                "the kernel is %.0fx faster than that.\n", 1e3 * fair_dt, fair_speedup);
    std::fprintf(stderr, "checksum %.6f\n", sink);
    return 0;
}

// Measures the kernel's error bound against the reference trajectory over the envelope
// (ADR-005) and prints it as a markdown table. Exit status is non-zero if the worst
// error exceeds the bound the README publishes.
#include <algorithm>
#include <cstdio>

#include "fourth_stump_envelope.hpp"

int main() {
    using namespace fs;
    const double swings[] = {0.0, 0.10, 0.20, envelope::kMaxSwing};
    envelope::Worst results[8];
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic)
#endif
    for (int i = 0; i < 8; ++i) results[i] = envelope::worst_error(swings[i / 2], i % 2 ? envelope::kMaxWind : 0.0);

    std::puts("| Swing coefficient | Wind (m/s) | Deliveries | Worst error at bat plane (mm) | Worst error at stumps (mm) |");
    std::puts("|---|---|---|---|---|");
    double worst = 0.0;
    for (int i = 0; i < 8; ++i) {
        const envelope::Worst& w = results[i];
        std::printf("| %.2f | %.0f | %zu | %.2f | %.2f |\n", swings[i / 2], i % 2 ? envelope::kMaxWind : 0.0,
                    w.deliveries, 1e3 * w.bat, 1e3 * w.stumps);
        worst = std::max({worst, w.bat, w.stumps});
    }
    std::printf("\nWorst error over the envelope: %.2f mm (published bound: %.1f mm)\n", 1e3 * worst,
                1e3 * envelope::kPublishedBound);
    return worst <= envelope::kPublishedBound ? 0 : 1;
}

// Measures the kernel's error bound against the reference trajectory over the envelope
// (ADR-005) and prints it as a markdown table. Exit status is non-zero if the worst
// error exceeds the bound the README publishes.
#include <algorithm>
#include <cstdio>
#include <initializer_list>

#include "fourth_stump_envelope.hpp"

int main() {
    using namespace fs;
    std::puts("| Swing coefficient | Wind (m/s) | Deliveries | Worst error at bat plane (mm) | Worst error at stumps (mm) |");
    std::puts("|---|---|---|---|---|");
    double worst = 0.0;
    for (double cs : {0.0, 0.10, 0.20, 0.30}) {
        for (double wind : {0.0, envelope::kMaxWind}) {
            const envelope::Worst w = envelope::worst_error(cs, wind);
            std::printf("| %.2f | %.0f | %zu | %.2f | %.2f |\n", cs, wind, w.deliveries, 1e3 * w.bat, 1e3 * w.stumps);
            worst = std::max({worst, w.bat, w.stumps});
        }
    }
    std::printf("\nWorst error over the envelope: %.2f mm (published bound: %.1f mm)\n", 1e3 * worst,
                1e3 * envelope::kPublishedBound);
    return worst <= envelope::kPublishedBound ? 0 : 1;
}

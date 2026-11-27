// The envelope within which the kernel's error bound is claimed (ADR-005), and the
// sweep that measures the bound. Shared by the error-bound tool and the tests.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <initializer_list>

#include "fourth_stump_engine.hpp"
#include "fourth_stump_reference.hpp"

namespace fs::envelope {

inline constexpr double kMinSpeed = 120.0 / 3.6, kMaxSpeed = 150.0 / 3.6;  // m/s
inline constexpr double kMaxSwing = 0.30;  // |C_s|
inline constexpr double kMaxWind = 5.0;    // m/s, any horizontal direction
// Release position: from tight to the stumps to the edge of the return crease, either
// side of the wicket, and from a low to a tall bowler's release height.
inline constexpr double kMaxReleaseX = 1.0;
inline constexpr double kMinReleaseZ = 1.9, kMaxReleaseZ = 2.4;
// Length: from a full toss (aimed to land this far behind the stumps) to a bouncer.
inline constexpr double kMinLength = -1.0, kMaxLength = 10.0;
inline constexpr double kPublishedBound = 0.008;  // metres; the README's figure

struct Worst {
    double bat = 0.0, stumps = 0.0;
    std::size_t deliveries = 0;
};

inline double distance(const State& a, const State& b) noexcept { return std::hypot(a.x - b.x, a.z - b.z); }

// The release from (x, z) at `speed` that would bounce at `length` on the line `line`.
inline Release release_for(double x, double z, double speed, double length, double line, const Conditions& c) noexcept {
    return aim(x, z, speed, line + (x - line) * length / c.release_y, length, c);
}

// Worst kernel error for one swing coefficient magnitude and wind speed, swept over
// speed, length (including full tosses), line, release position, swing direction,
// wind direction, seam deviation, restitution and slope.
inline Worst worst_error(double cs_abs, double wind_speed, double reference_dt = 1e-4) noexcept {
    Worst w;
    for (double speed : {kMinSpeed, 0.5 * (kMinSpeed + kMaxSpeed), kMaxSpeed})
    for (double length : {kMinLength, 1.0, 3.5, 6.5, kMaxLength})
    for (double line : {-0.20, 0.23, 0.60})
    for (double release_x : {-kMaxReleaseX, -0.45, 0.45, kMaxReleaseX})
    for (double release_z : {kMinReleaseZ, kMaxReleaseZ})
    for (double sign : {1.0, -1.0})
    for (int heading = 0; heading < (wind_speed > 0.0 ? 8 : 1); ++heading)
    for (double seam : {-0.03, 0.03})
    for (double e_z : {0.46, 0.65})
    for (double tilt : {-0.0191, 0.0191}) {
        if (cs_abs == 0.0 && sign < 0.0) continue;
        Conditions c;
        c.cs_mean = sign * cs_abs;
        c.e_z = e_z;
        c.tilt = tilt;
        c.wind_x = wind_speed * std::cos(heading * kPi / 4.0);
        c.wind_y = wind_speed * std::sin(heading * kPi / 4.0);
        const Release r = release_for(release_x, release_z, speed, length, line, c);
        const Flight k = make_flight(release_state(r), c.cs_mean, seam, c, pitch_of(c));
        const reference::Path ref = reference::fly(r, c.cs_mean, seam, c, reference_dt);
        w.bat = std::max(w.bat, distance(k.at(c.release_y - kBatPlaneY), ref.bat));
        w.stumps = std::max(w.stumps, distance(k.at(c.release_y), ref.stumps));
        ++w.deliveries;
    }
    return w;
}

}  // namespace fs::envelope

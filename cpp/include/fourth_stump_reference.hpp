// Reference trajectory: RK4 integration of the full equations of motion (ADR-004).
// It exists only to judge the kernel. Not used by simulate_batch.
#pragma once

#include "fourth_stump_engine.hpp"

namespace fs::reference {

struct Vec3 {
    double x, s, z;
};

// Gravity, quadratic drag and the seam side force, all on air-relative velocity.
inline Vec3 acceleration(double vx, double vs, double vz, double ks, const Conditions& c) noexcept {
    const double ux = vx - c.wind_x, us = vs + c.wind_y, uz = vz;  // forward wind component is -wind_y
    const double speed = std::sqrt(ux * ux + us * us + uz * uz);
    const double h = std::hypot(ux, us);
    // Side force: horizontal, perpendicular to the air-relative velocity, towards +x.
    return {-kDragK * speed * ux + ks * speed * speed * us / h,
            -kDragK * speed * us - ks * speed * speed * ux / h,
            -kDragK * speed * uz - kGravity};
}

inline State rk4_step(const State& a, double dt, double ks, const Conditions& c) noexcept {
    const Vec3 k1 = acceleration(a.vx, a.vs, a.vz, ks, c);
    const Vec3 k2 = acceleration(a.vx + 0.5 * dt * k1.x, a.vs + 0.5 * dt * k1.s, a.vz + 0.5 * dt * k1.z, ks, c);
    const Vec3 k3 = acceleration(a.vx + 0.5 * dt * k2.x, a.vs + 0.5 * dt * k2.s, a.vz + 0.5 * dt * k2.z, ks, c);
    const Vec3 k4 = acceleration(a.vx + dt * k3.x, a.vs + dt * k3.s, a.vz + dt * k3.z, ks, c);
    // Position stages reuse the velocity stages: p' = v.
    return {a.x + dt * (a.vx + dt / 6.0 * (k1.x + k2.x + k3.x)),
            a.s + dt * (a.vs + dt / 6.0 * (k1.s + k2.s + k3.s)),
            a.z + dt * (a.vz + dt / 6.0 * (k1.z + k2.z + k3.z)),
            a.vx + dt / 6.0 * (k1.x + 2.0 * k2.x + 2.0 * k3.x + k4.x),
            a.vs + dt / 6.0 * (k1.s + 2.0 * k2.s + 2.0 * k3.s + k4.s),
            a.vz + dt / 6.0 * (k1.z + 2.0 * k2.z + 2.0 * k3.z + k4.z),
            a.t + dt};
}

inline State lerp(const State& a, const State& b, double f) noexcept {
    return {a.x + f * (b.x - a.x),    a.s + f * (b.s - a.s),    a.z + f * (b.z - a.z), a.vx + f * (b.vx - a.vx),
            a.vs + f * (b.vs - a.vs), a.vz + f * (b.vz - a.vz), a.t + f * (b.t - a.t)};
}

struct Path {
    State bounce_out, bat, stumps;
    bool bounced;
};

// Same release, swing coefficient, seam deviation and bounce map as the kernel.
inline Path fly(const Release& r, double cs, double seam_deviation, const Conditions& c, double dt = 1e-4) noexcept {
    const double s_bat = c.release_y - kBatPlaneY, s_stumps = c.release_y;
    const double ks = kAeroK * cs;
    const Pitch pitch = pitch_of(c);
    Path path{};
    State a = release_state(r);
    bool got_bat = false;
    for (;;) {
        const State b = rk4_step(a, dt, ks, c);
        if (!path.bounced && b.z <= kBallRadius && b.vz < 0.0 && b.s < s_stumps) {
            a = lerp(a, b, (a.z - kBallRadius) / (a.z - b.z));
            bounce(a, pitch, seam_deviation);
            path.bounce_out = a;
            path.bounced = true;
            continue;
        }
        if (!got_bat && b.s >= s_bat) {
            path.bat = lerp(a, b, (s_bat - a.s) / (b.s - a.s));
            got_bat = true;
        }
        if (b.s >= s_stumps) {
            path.stumps = lerp(a, b, (s_stumps - a.s) / (b.s - a.s));
            return path;
        }
        a = b;
    }
}

}  // namespace fs::reference

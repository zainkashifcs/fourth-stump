// Fourth Stump EV engine. Header-only, C++20, no allocation inside simulate_batch.
// Vocabulary follows GLOSSARY.md; decisions are in ADR/.
//
// Coordinates (ADR-012): origin at the base of the batter's middle stump, +x is the
// off side of a right-hander, +y points up the pitch towards the bowler, +z is up.
// Internally a delivery is tracked by s = release_y - y, the distance travelled
// down the pitch, so that forward speed is positive.
#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <new>
#include <span>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace fs {

// ---- Physical constants --------------------------------------------------------
inline constexpr double kGravity = 9.81;
inline constexpr double kPi = 3.14159265358979323846;
inline constexpr double kBallRadius = 0.036;
inline constexpr double kBallMass = 0.156;
inline constexpr double kAirDensity = 1.2;
inline constexpr double kDragCoeff = 0.45;
inline constexpr double kBallArea = kPi * kBallRadius * kBallRadius;
// Acceleration per unit v^2 for a unit aerodynamic coefficient: (1/2) rho A / m.
inline constexpr double kAeroK = 0.5 * kAirDensity * kBallArea / kBallMass;
inline constexpr double kDragK = kAeroK * kDragCoeff;

// ---- Geometry ------------------------------------------------------------------
inline constexpr double kPitchLength = 20.12;
inline constexpr double kStumpHalfWidth = 0.1143;
inline constexpr double kStumpHeight = 0.711;
inline constexpr double kBatPlaneY = 1.22;       // popping crease, where the bat meets the ball
inline constexpr double kBatHalfWidth = 0.054;   // regulation 108 mm bat
inline constexpr double kEdgeInnerMargin = 0.010;  // model constant: inner limit of the edge band
inline constexpr double kCorridorMin = 0.18;
inline constexpr double kCorridorMax = 0.28;

// ---- Model constants (sources in ADR-006, ADR-008) -------------------------------
inline constexpr double kPaceRetention = 0.887;  // James, Carre & Haake (2004)
inline constexpr double kReactionTime = 0.2;     // McLeod (1987)
// Edge carry: stated assumptions, not fitted (ADR-007).
inline constexpr double kCordonDistance = 13.0;
// A thick edge (near the inner limit of the band) takes more pace off than a thin one.
inline constexpr double kEdgeSpeedThick = 0.60;
inline constexpr double kEdgeSpeedThin = 0.95;
inline constexpr double kCatchMinHeight = 0.05;

// ---- Random numbers (ADR-003) ----------------------------------------------------
constexpr std::uint64_t mix64(std::uint64_t z) noexcept {
    z += 0x9E3779B97F4A7C15ULL;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
}

// xoshiro256**. Its state is a function of (seed, delivery index, stream) only,
// never of the thread that runs it.
struct Rng {
    std::array<std::uint64_t, 4> s;

    constexpr explicit Rng(std::array<std::uint64_t, 4> state) noexcept : s(state) {}
    constexpr Rng(std::uint64_t seed, std::uint64_t index, std::uint64_t stream = 0) noexcept : s{} {
        std::uint64_t h = mix64(mix64(mix64(seed) ^ index) ^ stream);
        for (auto& v : s) v = h = mix64(h);
    }
    constexpr std::uint64_t next() noexcept {
        const std::uint64_t result = rotl(s[1] * 5, 7) * 9;
        const std::uint64_t t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = rotl(s[3], 45);
        return result;
    }
    // Uniform on the open interval (0, 1).
    constexpr double uniform() noexcept { return (static_cast<double>(next() >> 11) + 0.5) * 0x1.0p-53; }

  private:
    static constexpr std::uint64_t rotl(std::uint64_t x, int k) noexcept { return (x << k) | (x >> (64 - k)); }
};

// Ziggurat tables for the standard normal (Marsaglia & Tsang, 2000), 128 layers.
struct ZigguratTables {
    static constexpr double kR = 3.442619855899;
    std::array<std::uint32_t, 128> kn{};
    std::array<double, 128> wn{}, fn{};

    ZigguratTables() noexcept {
        const double m1 = 2147483648.0, vn = 9.91256303526217e-3;
        double dn = kR, tn = kR;
        const double q = vn / std::exp(-0.5 * dn * dn);
        kn[0] = static_cast<std::uint32_t>((dn / q) * m1);
        kn[1] = 0;
        wn[0] = q / m1;
        wn[127] = dn / m1;
        fn[0] = 1.0;
        fn[127] = std::exp(-0.5 * dn * dn);
        for (int i = 126; i >= 1; --i) {
            dn = std::sqrt(-2.0 * std::log(vn / dn + std::exp(-0.5 * dn * dn)));
            kn[static_cast<std::size_t>(i) + 1] = static_cast<std::uint32_t>((dn / tn) * m1);
            tn = dn;
            fn[static_cast<std::size_t>(i)] = std::exp(-0.5 * dn * dn);
            wn[static_cast<std::size_t>(i)] = dn / m1;
        }
    }
};

inline const ZigguratTables& ziggurat() noexcept {
    static const ZigguratTables tables;  // built once, on the stack of static storage: no heap
    return tables;
}

// Standard normal draw. Rejection means deliveries consume a varying number of
// draws, which is why each delivery owns its stream.
inline double normal(Rng& rng) noexcept {
    const ZigguratTables& t = ziggurat();
    for (;;) {
        const std::uint64_t u = rng.next();
        const auto hz = static_cast<std::int32_t>(u >> 32);
        const std::size_t iz = u & 127;
        const std::uint32_t mag = hz < 0 ? 0u - static_cast<std::uint32_t>(hz) : static_cast<std::uint32_t>(hz);
        if (mag < t.kn[iz]) return hz * t.wn[iz];
        if (iz == 0) {  // tail beyond kR
            double x, y;
            do {
                x = -std::log(rng.uniform()) / ZigguratTables::kR;
                y = -std::log(rng.uniform());
            } while (y + y < x * x);
            return hz > 0 ? ZigguratTables::kR + x : -ZigguratTables::kR - x;
        }
        const double x = hz * t.wn[iz];
        if (t.fn[iz] + rng.uniform() * (t.fn[iz - 1] - t.fn[iz]) < std::exp(-0.5 * x * x)) return x;
    }
}

// ---- Inputs ----------------------------------------------------------------------
// Everything about a venue, ball and bowling end that a batch shares.
struct Conditions {
    double cs_mean = 0.10;       // mean swing coefficient; + swings towards +x (away from a right-hander)
    double sigma_swing = 0.05;   // spread of the swing coefficient between deliveries
    double sigma_seam = 0.010;   // spread of the seam deviation angle, radians
    double e_z = 0.55;           // vertical restitution
    double pace_retention = kPaceRetention;
    double tilt = 0.0;           // slope of the pitch surface, radians; + deflects the ball towards +x
    double wind_x = 0.0;         // m/s, ground frame
    double wind_y = 0.0;         // m/s, + blows from the batter towards the bowler (a headwind for the ball)
    double release_y = 18.90;    // distance from the batter's stumps at release
    double reaction_time = kReactionTime;
};

struct Release {
    double x, z;         // position at release (y is Conditions::release_y)
    double vx, vy, vz;   // velocity at release; vy is negative
};

// Caller-owned structure-of-arrays views (ADR-012). The engine never allocates.
struct ReleaseBatch {
    std::span<const double> x, z, vx, vy, vz;
    std::size_t size() const noexcept { return x.size(); }
};

enum class LeaveOutcome : std::uint8_t { Safe = 0, Bowled = 1 };
// EdgedCarried means the edge reached the slip cordon; whether it is then caught is the
// catch conversion, applied in expectation by Summary (ADR-010).
enum class PlayOutcome : std::uint8_t { Middled = 0, EdgedSafe = 1, EdgedCarried = 2, Missed = 3, MissedBowled = 4 };

struct OutcomeBatch {
    std::span<double> bat_x, bat_z;        // arrival at the bat plane
    std::span<double> stumps_x, stumps_z;  // arrival at the batter's stumps
    std::span<double> expected_x;          // where the batter expected it at the bat plane
    std::span<double> bounce_x, bounce_y;  // bounce point (y = -1 if it did not bounce)
    std::span<std::uint8_t> leave, play;   // LeaveOutcome, PlayOutcome
};

// ---- Kernel (ADR-005) --------------------------------------------------------------
struct State {
    double x, s, z;      // ground-frame position; s is distance travelled down the pitch
    double vx, vs, vz;   // ground-frame velocity; vs > 0
    double t;
};

// One flight leg, held in the frame moving with the wind, where the air is still.
struct Leg {
    double x0, s0, z0, t0;
    double u;            // forward air speed at the start of the leg
    double tx, tz;       // direction slopes ux/u and uz/u at the start
    double ks;           // signed side-force constant, kAeroK * C_s
    double wx, ws;       // wind across and along the direction of travel
};

inline Leg make_leg(const State& a, double cs, const Conditions& c) noexcept {
    const double ws = -c.wind_y;
    const double u = a.vs - ws;
    return {a.x, a.s, a.z, a.t, u, (a.vx - c.wind_x) / u, a.vz / u, kAeroK * cs, c.wind_x, ws};
}

// Second-order corrections to the flat-trajectory approximation, with d the distance
// along the leg. The path's slopes change linearly along a leg to this order (swing
// turns it sideways, gravity turns it down), so each correction is a mean of slope
// products over the leg: a plain mean where it feeds a velocity, and a mean weighted
// towards the start of the leg where it feeds a position, because curvature early in
// the leg has longer to act.
//   ke      speed decay: the path is longer than d, and the side force has a backward
//           component once the path has turned
//   kx_*    sideways curvature per metre
//   kz_*    vertical curvature the side force adds when the path slopes both ways
struct Coefficients {
    double ke, kx_vel, kx_pos, kz_vel, kz_pos;
};
inline Coefficients coefficients(const Leg& l, double d) noexcept {
    const double dx = l.ks * d;                      // change in sideways slope over the leg
    const double dz = -kGravity * d / (l.u * l.u);   // change in vertical slope over the leg
    // Mean of (p + a q)(r + b q) for q on [0, 1]: c1 = 1/2, c2 = 1/3 unweighted;
    // c1 = 1/3, c2 = 1/6 with weight 2 (1 - q).
    const auto mean = [](double p, double a, double r, double b, double c1, double c2) {
        return p * r + (p * b + r * a) * c1 + a * b * c2;
    };
    const double xx_v = mean(l.tx, dx, l.tx, dx, 1.0 / 2, 1.0 / 3), xx_p = mean(l.tx, dx, l.tx, dx, 1.0 / 3, 1.0 / 6);
    const double zz_v = mean(l.tz, dz, l.tz, dz, 1.0 / 2, 1.0 / 3), zz_p = mean(l.tz, dz, l.tz, dz, 1.0 / 3, 1.0 / 6);
    const double xz_v = mean(l.tx, dx, l.tz, dz, 1.0 / 2, 1.0 / 3), xz_p = mean(l.tx, dx, l.tz, dz, 1.0 / 3, 1.0 / 6);
    return {kDragK * (1.0 + 0.5 * (xx_v + zz_v)) + l.ks * (l.tx + 0.5 * dx),
            l.ks * (1.0 + 1.5 * xx_v + zz_v), l.ks * (1.0 + 1.5 * xx_p + zz_p), l.ks * xz_v, l.ks * xz_p};
}

// State after travelling air distance d along the leg. One exp.
//   speed:    u(d) = u0 exp(-ke d)                    (quadratic drag, exact along the pitch)
//   swing:    x(d) = x0 + tx d + kx d^2 / 2           (drag and side force both scale with v^2)
//   gravity:  z(d) = z0 + tz d + kz d^2 / 2 - g (e^{2 ke d} - 1 - 2 ke d) / (4 ke^2 u0^2)
inline State eval(const Leg& l, double d) noexcept {
    const Coefficients k = coefficients(l, d);
    const double kd = k.ke * d;
    const double e = std::exp(kd);
    const double inv_u2 = 1.0 / (l.u * l.u);
    const double t = (e - 1.0) / (k.ke * l.u);
    const double us = l.u / e;
    const double slope_x = l.tx + k.kx_vel * d;
    const double slope_z = l.tz + k.kz_vel * d - kGravity * (e * e - 1.0) * inv_u2 / (2.0 * k.ke);
    return {l.x0 + l.tx * d + 0.5 * k.kx_pos * d * d + l.wx * t,
            l.s0 + d + l.ws * t,
            l.z0 + l.tz * d + 0.5 * k.kz_pos * d * d - kGravity * (e * e - 1.0 - 2.0 * kd) * inv_u2 / (4.0 * k.ke * k.ke),
            slope_x * us + l.wx,
            us + l.ws,
            slope_z * us,
            l.t0 + t};
}

// State where the leg crosses the ground plane s = s_target. Without wind along the
// pitch the air distance is s_target - s0 directly; with it, the distance solves a
// Lambert-W-type equation, handled by two Newton steps (ADR-012).
inline State to_plane(const Leg& l, double s_target) noexcept {
    const double span_s = s_target - l.s0;
    double d = span_s;
    if (l.ws != 0.0) {
        d = span_s / (1.0 + l.ws / l.u);
        for (int i = 0; i < 2; ++i) {
            const double ke = coefficients(l, d).ke;
            const double e = std::exp(ke * d);
            d -= (d + l.ws * (e - 1.0) / (ke * l.u) - span_s) / (1.0 + l.ws * e / l.u);
        }
    }
    return eval(l, d);
}

// State at time t on the leg. One log, one exp.
inline State at_time(const Leg& l, double t) noexcept {
    const double tau = t - l.t0;
    const double ke = coefficients(l, l.u * tau).ke;
    return eval(l, std::log1p(ke * l.u * tau) / ke);
}

// State where the ball's centre comes down to one radius above the pitch.
inline State to_bounce(const Leg& l) noexcept {
    const double u2_g = l.u * l.u / kGravity;
    const double h = l.z0 - kBallRadius;
    double d = (l.tz + std::sqrt(l.tz * l.tz + 2.0 * h / u2_g)) * u2_g;  // drag-free guess
    // One Newton step on the drop with first-order drag, (d^2 / 2 u2_g)(1 + 2 k d / 3): no exp.
    const double kd = kDragK * d;
    d -= (h + l.tz * d - 0.5 * d * d / u2_g * (1.0 + 2.0 / 3.0 * kd)) / (l.tz - d / u2_g * (1.0 + kd));
    // One Newton step on the kernel itself.
    const State st = eval(l, d);
    d -= (st.z - kBallRadius) * (st.vs - l.ws) / st.vz;  // dz/dd = vz / (forward air speed)
    return eval(l, d);
}

// ---- Bounce (ADR-006) ----------------------------------------------------------------
// Reflect about the surface normal, scale the normal and tangential speeds, then turn
// the outgoing direction by the seam deviation. Shared by the kernel and the reference.
struct Pitch {  // the surface as the bounce sees it, computed once per batch
    double sn, cn, e_z, pace_retention;
};
inline Pitch pitch_of(const Conditions& c) noexcept {
    return {std::sin(c.tilt), std::cos(c.tilt), c.e_z, c.pace_retention};
}

inline void bounce(State& st, const Pitch& p, double seam_deviation) noexcept {
    const double vn = st.vx * p.sn + st.vz * p.cn;  // into the pitch: negative
    const double ox = p.pace_retention * (st.vx - vn * p.sn) - p.e_z * vn * p.sn;
    const double os = p.pace_retention * st.vs;
    st.vz = p.pace_retention * (st.vz - vn * p.cn) - p.e_z * vn * p.cn;
    st.vx = ox;
    st.vs = os;
    if (seam_deviation != 0.0) {
        const double cd = std::cos(seam_deviation), sd = std::sin(seam_deviation);
        st.vx = ox * cd + os * sd;
        st.vs = os * cd - ox * sd;
    }
}

// A delivery's whole flight: one or two legs joined by the bounce.
struct Flight {
    Leg first, second;
    State bounce_out;   // state leaving the pitch; meaningful only if bounced
    double bounce_s;    // distance down the pitch at the bounce
    bool bounced;

    State at(double s) const noexcept { return (!bounced || s <= bounce_s) ? to_plane(first, s) : to_plane(second, s); }
    State at_time(double t) const noexcept { return (!bounced || t <= second.t0) ? fs::at_time(first, t) : fs::at_time(second, t); }
};

// `may_bounce` is false when the starting state has already left the pitch.
inline Flight make_flight(const State& start, double cs, double seam_deviation, const Conditions& c,
                          const Pitch& pitch, bool may_bounce = true) noexcept {
    Flight f{make_leg(start, cs, c), {}, {}, 0.0, false};
    if (!may_bounce) return f;
    State b = to_bounce(f.first);
    if (b.s >= c.release_y) return f;  // reaches the stumps on the full
    f.bounced = true;
    f.bounce_s = b.s;
    bounce(b, pitch, seam_deviation);
    f.bounce_out = b;
    f.second = make_leg(b, cs, c);
    return f;
}

inline State release_state(const Release& r) noexcept { return {r.x, 0.0, r.z, r.vx, -r.vy, r.vz, 0.0}; }

// ---- Outcome model (ADR-007, ADR-008) -------------------------------------------------
struct DeliveryResult {
    State bat, stumps;
    double expected_x;
    double bounce_x, bounce_y;
    LeaveOutcome leave;
    PlayOutcome play;
};

inline bool hits_stumps(double x, double z) noexcept {
    return std::abs(x) <= kStumpHalfWidth + kBallRadius && z <= kStumpHeight + kBallRadius;
}

// An edge carries if, flying on from the bat with its speed along the ground reduced,
// it is still above catching height when it reaches the slip cordon. The thinner the
// edge, the more speed it keeps. `gap` is the unsigned size of the gap.
inline bool edge_carries(const State& bat, double gap) noexcept {
    const double inner = kBatHalfWidth - kEdgeInnerMargin, outer = kBatHalfWidth + kBallRadius;
    const double retention = kEdgeSpeedThick + (kEdgeSpeedThin - kEdgeSpeedThick) * (gap - inner) / (outer - inner);
    const double t = kCordonDistance / (retention * std::hypot(bat.vx, bat.vs));
    return bat.z + bat.vz * t - 0.5 * kGravity * t * t >= kCatchMinHeight;
}

// `gap` is signed: positive when the ball passes on the off side of where the batter
// put the bat. Only that outside edge can reach the slip cordon; an inside edge goes
// to ground or onto the pad.
inline PlayOutcome classify_play(double gap, const State& bat, bool bowled) noexcept {
    const double size = std::abs(gap);
    if (size < kBatHalfWidth - kEdgeInnerMargin) return PlayOutcome::Middled;
    if (size < kBatHalfWidth + kBallRadius)
        return gap > 0.0 && edge_carries(bat, size) ? PlayOutcome::EdgedCarried : PlayOutcome::EdgedSafe;
    return bowled ? PlayOutcome::MissedBowled : PlayOutcome::Missed;
}

// One delivery, both actions, on the same trajectory (common random numbers).
inline DeliveryResult simulate_delivery(const Release& r, double cs, double seam_deviation, const Conditions& c,
                                        const Pitch& pitch) noexcept {
    const double s_bat = c.release_y - kBatPlaneY;
    const State start = release_state(r);
    const Flight actual = make_flight(start, cs, seam_deviation, c, pitch);
    DeliveryResult out{};
    out.bat = actual.at(s_bat);
    out.stumps = actual.at(c.release_y);
    out.bounce_x = actual.bounced ? actual.bounce_out.x : 0.0;
    out.bounce_y = actual.bounced ? c.release_y - actual.bounce_s : -1.0;

    // The batter tracks the true path until one reaction time before arrival, then
    // expects mean swing and no seam deviation for whatever flight remains.
    const double t_commit = out.bat.t - c.reaction_time;
    const bool before_bounce = !actual.bounced || t_commit <= actual.second.t0;
    const State commit = t_commit <= 0.0 ? start : actual.at_time(t_commit);
    out.expected_x = make_flight(commit, c.cs_mean, 0.0, c, pitch, before_bounce).at(s_bat).x;

    const bool bowled = hits_stumps(out.stumps.x, out.stumps.z);
    out.leave = bowled ? LeaveOutcome::Bowled : LeaveOutcome::Safe;
    out.play = classify_play(out.bat.x - out.expected_x, out.bat, bowled);
    return out;
}

inline DeliveryResult simulate_delivery(const Release& r, double cs, double seam_deviation,
                                        const Conditions& c) noexcept {
    return simulate_delivery(r, cs, seam_deviation, c, pitch_of(c));
}

// The two random draws a delivery owns, in a fixed order.
struct Draws {
    double cs, seam_deviation;
};
inline Draws draw(std::uint64_t seed, std::uint64_t index, const Conditions& c) noexcept {
    Rng rng(seed, index);
    const double cs = c.cs_mean + c.sigma_swing * normal(rng);
    return {cs, c.sigma_seam * normal(rng)};
}

// Simulate every delivery in the batch. Each result is written to its own index and
// depends only on (seed, index, inputs), so output is bit-identical for any thread
// count or schedule (ADR-003).
// Preconditions, not checked here (the Python binding checks them): every release starts
// above the pitch (z > kBallRadius) and travels down it (vy < 0) faster than any tailwind.
// A second bounce is not modelled.
inline void simulate_batch(const ReleaseBatch& in, const Conditions& c, std::uint64_t seed,
                           OutcomeBatch& out) noexcept {
    (void)ziggurat();  // build the tables before the parallel region
    const Pitch pitch = pitch_of(c);
    const auto n = static_cast<std::ptrdiff_t>(in.size());
#ifdef _OPENMP
#pragma omp parallel for schedule(static)
#endif
    for (std::ptrdiff_t k = 0; k < n; ++k) {
        const auto i = static_cast<std::size_t>(k);
        const Draws d = draw(seed, i, c);
        const DeliveryResult r =
            simulate_delivery({in.x[i], in.z[i], in.vx[i], in.vy[i], in.vz[i]}, d.cs, d.seam_deviation, c, pitch);
        out.bat_x[i] = r.bat.x;
        out.bat_z[i] = r.bat.z;
        out.stumps_x[i] = r.stumps.x;
        out.stumps_z[i] = r.stumps.z;
        out.expected_x[i] = r.expected_x;
        out.bounce_x[i] = r.bounce_x;
        out.bounce_y[i] = r.bounce_y;
        out.leave[i] = static_cast<std::uint8_t>(r.leave);
        out.play[i] = static_cast<std::uint8_t>(r.play);
    }
}

// ---- Aggregation -----------------------------------------------------------------------
// Integer counts only, so the totals do not depend on summation order.
struct Summary {
    std::uint64_t n = 0, leave_bowled = 0;
    std::array<std::uint64_t, 5> play{};  // indexed by PlayOutcome

    double p_wicket_leave() const noexcept { return ratio(leave_bowled); }
    // A played delivery is a dismissal if it is missed and hits the stumps, or if its
    // edge carries and is caught; catch_conversion is the share of carrying edges caught.
    double p_wicket_play(double catch_conversion) const noexcept {
        return catch_conversion * ratio(play[2]) + ratio(play[4]);
    }
    double p_middled() const noexcept { return ratio(play[0]); }
    // EV(action) = E[runs | action] - lambda * P(wicket | action)
    double ev_leave(double wicket_cost) const noexcept { return -wicket_cost * p_wicket_leave(); }
    double ev_play(double wicket_cost, double runs_middled, double catch_conversion) const noexcept {
        return runs_middled * p_middled() - wicket_cost * p_wicket_play(catch_conversion);
    }

  private:
    double ratio(std::uint64_t count) const noexcept { return n ? static_cast<double>(count) / static_cast<double>(n) : 0.0; }
};

inline Summary summarize(std::span<const std::uint8_t> leave, std::span<const std::uint8_t> play) noexcept {
    Summary s;
    s.n = leave.size();
    for (std::size_t i = 0; i < leave.size(); ++i) {
        s.leave_bowled += leave[i];
        ++s.play[play[i]];
    }
    return s;
}

// ---- Building releases (not part of the hot loop) ------------------------------------------
// The release from (x, z) at `speed` that, under mean swing and no wind, bounces at
// (bounce_x, bounce_y). Two fixed-point passes settle the forward speed.
inline Release aim(double x, double z, double speed, double bounce_x, double bounce_y, const Conditions& c) noexcept {
    const double d = c.release_y - bounce_y;
    const double ks = kAeroK * c.cs_mean;
    double tx = 0.0, tz = 0.0, u = speed;
    for (int i = 0; i < 3; ++i) {
        u = speed / std::sqrt(1.0 + tx * tx + tz * tz);
        const double e2 = std::exp(2.0 * kDragK * d);
        tx = (bounce_x - x) / d - 0.5 * ks * d;
        tz = (kBallRadius - z + kGravity * (e2 - 1.0 - 2.0 * kDragK * d) / (4.0 * kDragK * kDragK * u * u)) / d;
    }
    return {x, z, tx * u, -u, tz * u};
}

// A population of releases: speed, length (bounce distance from the batter's stumps)
// and line (x where a straight path through the bounce would pass the stumps) are
// independent normals.
struct ReleaseSpec {
    double x = 0.45, z = 2.10;                    // right-arm over the wicket to a right-hander
    double speed_mean = 37.5, speed_sd = 1.5;     // m/s (135 km/h)
    double length_mean = 6.5, length_sd = 1.2;
    double line_mean = 0.23, line_sd = 0.15;
};

inline void sample_releases(const ReleaseSpec& spec, const Conditions& c, std::uint64_t seed, std::span<double> x,
                            std::span<double> z, std::span<double> vx, std::span<double> vy,
                            std::span<double> vz) noexcept {
    for (std::size_t i = 0; i < x.size(); ++i) {
        Rng rng(seed, i, 1);  // stream 1: independent of the physics draws
        const double speed = spec.speed_mean + spec.speed_sd * normal(rng);
        const double length = spec.length_mean + spec.length_sd * normal(rng);
        const double line = spec.line_mean + spec.line_sd * normal(rng);
        const double bounce_x = line + (spec.x - line) * length / c.release_y;
        const Release r = aim(spec.x, spec.z, speed, bounce_x, length, c);
        x[i] = r.x;
        z[i] = r.z;
        vx[i] = r.vx;
        vy[i] = r.vy;
        vz[i] = r.vz;
    }
}

// ---- Owning storage for callers that want it -------------------------------------------------
// 64-byte-aligned arrays for one batch. Allocation happens here, never in the engine.
template <typename T>
class AlignedArray {
  public:
    explicit AlignedArray(std::size_t n)
        : data_(static_cast<T*>(::operator new[](n * sizeof(T), std::align_val_t{64}))), size_(n) {}
    ~AlignedArray() { ::operator delete[](data_, std::align_val_t{64}); }
    AlignedArray(const AlignedArray&) = delete;
    AlignedArray& operator=(const AlignedArray&) = delete;
    std::span<T> span() noexcept { return {data_, size_}; }
    std::span<const T> span() const noexcept { return {data_, size_}; }

  private:
    T* data_;
    std::size_t size_;
};

struct BatchStorage {
    AlignedArray<double> x, z, vx, vy, vz;
    AlignedArray<double> bat_x, bat_z, stumps_x, stumps_z, expected_x, bounce_x, bounce_y;
    AlignedArray<std::uint8_t> leave, play;

    explicit BatchStorage(std::size_t n)
        : x(n), z(n), vx(n), vy(n), vz(n), bat_x(n), bat_z(n), stumps_x(n), stumps_z(n), expected_x(n),
          bounce_x(n), bounce_y(n), leave(n), play(n) {}

    ReleaseBatch releases() const noexcept { return {x.span(), z.span(), vx.span(), vy.span(), vz.span()}; }
    OutcomeBatch outcomes() noexcept {
        return {bat_x.span(), bat_z.span(), stumps_x.span(), stumps_z.span(), expected_x.span(),
                bounce_x.span(), bounce_y.span(), leave.span(), play.span()};
    }
    void sample(const ReleaseSpec& spec, const Conditions& c, std::uint64_t seed) noexcept {
        sample_releases(spec, c, seed, x.span(), z.span(), vx.span(), vy.span(), vz.span());
    }
};

}  // namespace fs

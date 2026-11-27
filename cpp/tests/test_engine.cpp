// Behavioural tests for the engine, through its public interface.
#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#include "catch_amalgamated.hpp"
#include "fourth_stump_envelope.hpp"

using namespace fs;
using Catch::Approx;

namespace {

const double kGoodLength = 6.5;

// A release from right-arm over that bounces at `length` on the line `line`.
Release release_to(double length, double line, const Conditions& c, double speed = 37.5) {
    const double release_x = 0.45;
    return aim(release_x, 2.10, speed, line + (release_x - line) * length / c.release_y, length, c);
}

Conditions quiet() {  // no randomness: every delivery is the mean delivery
    Conditions c;
    c.sigma_swing = 0.0;
    c.sigma_seam = 0.0;
    c.sigma_ez = 0.0;
    return c;
}

}  // namespace

// ---- Random numbers ------------------------------------------------------------------

TEST_CASE("xoshiro256** reproduces its published reference sequence") {
    Rng rng(std::array<std::uint64_t, 4>{1, 2, 3, 4});
    CHECK(rng.next() == 11520ULL);
    CHECK(rng.next() == 0ULL);
    CHECK(rng.next() == 1509978240ULL);
    CHECK(rng.next() == 1215971899390074240ULL);
}

TEST_CASE("a delivery's stream depends only on seed, delivery index and stream") {
    CHECK(Rng(7, 3).next() == Rng(7, 3).next());
    CHECK(Rng(7, 3).next() != Rng(7, 4).next());
    CHECK(Rng(7, 3).next() != Rng(8, 3).next());
    CHECK(Rng(7, 3, 0).next() != Rng(7, 3, 1).next());
}

TEST_CASE("Ziggurat draws are standard normal") {
    const int n = 4'000'000;
    Rng rng(2026, 0);
    double m1 = 0, m2 = 0, m4 = 0;
    int tail = 0;
    for (int i = 0; i < n; ++i) {
        const double x = normal(rng);
        m1 += x;
        m2 += x * x;
        m4 += x * x * x * x;
        tail += std::abs(x) > ZigguratTables::kR;
    }
    m1 /= n, m2 /= n, m4 /= n;
    CHECK(std::abs(m1) < 0.003);
    CHECK(m2 == Approx(1.0).margin(0.005));
    CHECK(m4 == Approx(3.0).margin(0.03));
    CHECK(static_cast<double>(tail) / n == Approx(5.76e-4).epsilon(0.10));  // 2 (1 - Phi(3.4426))
}

// ---- Kernel against the reference trajectory --------------------------------------------

TEST_CASE("the kernel stays inside its published error bound over the whole envelope") {
    const double swings[] = {0.0, 0.10, 0.20, envelope::kMaxSwing};
    double worst[8] = {};
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic)
#endif
    for (int i = 0; i < 8; ++i) {
        const envelope::Worst w = envelope::worst_error(swings[i / 2], i % 2 ? envelope::kMaxWind : 0.0, 2.5e-4);
        worst[i] = std::max(w.bat, w.stumps);
    }
    for (int i = 0; i < 8; ++i) {
        INFO("swing coefficient " << swings[i / 2] << (i % 2 ? " with wind" : " without wind"));
        CHECK(worst[i] <= envelope::kPublishedBound);
    }
}

TEST_CASE("swing at a given distance does not depend on speed") {
    // Drag and the side force both scale with v^2, so curvature per metre is constant.
    Conditions c = quiet();
    const double d = c.release_y - kBatPlaneY;
    const double parabola = 0.5 * kAeroK * c.cs_mean * d * d;
    double swing[2];
    int i = 0;
    for (double speed : {envelope::kMinSpeed, envelope::kMaxSpeed}) {
        const Release flat{0.0, 2.10, 0.0, -speed, 0.0};
        const reference::Path ref = reference::fly(flat, c.cs_mean, 0.0, c);
        REQUIRE_FALSE(ref.bounced);
        swing[i++] = ref.bat.x;
    }
    CHECK(swing[0] == Approx(parabola).epsilon(0.02));
    CHECK(swing[1] == Approx(parabola).epsilon(0.02));
    CHECK(swing[0] == Approx(swing[1]).epsilon(0.01));
}

// ---- Bounce ---------------------------------------------------------------------------

TEST_CASE("the slope moves a delivery down the hill by a few centimetres") {
    Conditions flat = quiet(), pavilion = quiet(), nursery = quiet();
    pavilion.tilt = -0.0191;  // into a right-hander: towards -x
    nursery.tilt = +0.0191;
    const Release r = release_to(kGoodLength, 0.23, flat);
    const double x0 = simulate_delivery(r, flat.cs_mean, 0.0, flat).stumps.x;
    const double into = simulate_delivery(r, flat.cs_mean, 0.0, pavilion).stumps.x - x0;
    const double away = simulate_delivery(r, flat.cs_mean, 0.0, nursery).stumps.x - x0;
    CHECK(into < -0.01);
    CHECK(into > -0.06);
    CHECK(away == Approx(-into).margin(0.002));
}

TEST_CASE("higher vertical restitution makes the same delivery arrive higher") {
    Conditions low = quiet(), high = quiet();
    low.e_z = 0.50;
    high.e_z = 0.62;
    const Release r = release_to(kGoodLength, 0.23, low);
    CHECK(simulate_delivery(r, low.cs_mean, 0.0, high).stumps.z >
          simulate_delivery(r, low.cs_mean, 0.0, low).stumps.z + 0.05);
}

TEST_CASE("variable bounce changes how high a delivery arrives, not where it bounces") {
    Conditions c = quiet();
    c.sigma_ez = 0.03;
    const Release r = release_to(kGoodLength, 0.23, c);
    const std::size_t n = 2'000;
    BatchStorage batch(n);
    for (std::size_t i = 0; i < n; ++i) {
        batch.x.span()[i] = r.x, batch.z.span()[i] = r.z;
        batch.vx.span()[i] = r.vx, batch.vy.span()[i] = r.vy, batch.vz.span()[i] = r.vz;
    }
    OutcomeBatch out = batch.outcomes();
    simulate_batch(batch.releases(), c, 5, out);
    const auto [low, high] = std::minmax_element(batch.stumps_z.span().begin(), batch.stumps_z.span().end());
    CHECK(*high - *low > 0.10);
    const auto [near, far] = std::minmax_element(batch.bounce_y.span().begin(), batch.bounce_y.span().end());
    CHECK(*far - *near < 1e-12);
    const auto [left, right] = std::minmax_element(batch.expected_x.span().begin(), batch.expected_x.span().end());
    CHECK(*right - *left < 1e-6);  // the batter expects the mean bounce; only the commit time shifts
}

TEST_CASE("a drawn restitution stays between zero and one") {
    Conditions c;
    c.e_z = 0.95;
    c.sigma_ez = 0.5;
    for (std::uint64_t i = 0; i < 10'000; ++i) {
        const double e_z = draw(1, i, c).e_z;
        REQUIRE(e_z >= 0.0);
        REQUIRE(e_z <= 1.0);
    }
}

TEST_CASE("the bounce keeps the pace-retention fraction of speed along the pitch") {
    const Conditions c = quiet();
    State st{0, 0, kBallRadius, 0.0, 34.0, -6.0, 0};
    bounce(st, pitch_of(c), 0.0);
    CHECK(st.vs == Approx(kPaceRetention * 34.0));
    CHECK(st.vz == Approx(c.e_z * 6.0));
}

TEST_CASE("seam deviation turns the delivery sideways after the bounce only") {
    const Conditions c = quiet();
    const Release r = release_to(kGoodLength, 0.23, c);
    const DeliveryResult straight = simulate_delivery(r, c.cs_mean, 0.0, c);
    const DeliveryResult seamed = simulate_delivery(r, c.cs_mean, 0.02, c);
    CHECK(seamed.bounce_x == Approx(straight.bounce_x).margin(1e-12));
    CHECK(seamed.bat.x - straight.bat.x == Approx(0.02 * (kGoodLength - kBatPlaneY)).epsilon(0.05));
}

TEST_CASE("a delivery that reaches the stumps on the full has no bounce") {
    const Conditions c = quiet();
    const DeliveryResult full_toss = simulate_delivery(release_to(-2.0, 0.0, c), c.cs_mean, 0.0, c);
    CHECK(full_toss.bounce_y == -1.0);
    CHECK(std::isfinite(full_toss.stumps.x));
    CHECK(full_toss.stumps.z > kBallRadius);
}

// ---- Outcome model -----------------------------------------------------------------------

TEST_CASE("the gap sorts a played delivery into middled, edged or play-and-miss") {
    State rising{0, 0, 0.8, 0, 32.0, 6.0, 0}, dying{0, 0, 0.3, 0, 32.0, -3.0, 0};
    CHECK(classify_play(0.043, rising, false) == PlayOutcome::Middled);
    CHECK(classify_play(0.045, rising, false) == PlayOutcome::EdgedCarried);
    CHECK(classify_play(0.045, dying, false) == PlayOutcome::EdgedSafe);
    CHECK(classify_play(0.089, rising, false) == PlayOutcome::EdgedCarried);
    CHECK(classify_play(0.091, rising, false) == PlayOutcome::Missed);
    CHECK(classify_play(0.091, rising, true) == PlayOutcome::MissedBowled);
}

TEST_CASE("an inside edge never reaches the slip cordon") {
    const State rising{0, 0, 0.8, 0, 32.0, 6.0, 0};
    REQUIRE(classify_play(+0.060, rising, false) == PlayOutcome::EdgedCarried);
    CHECK(classify_play(-0.060, rising, false) == PlayOutcome::EdgedSafe);
    CHECK(classify_play(-0.020, rising, false) == PlayOutcome::Middled);
    CHECK(classify_play(-0.095, rising, true) == PlayOutcome::MissedBowled);
}

TEST_CASE("a thin edge carries further than a thick one") {
    // Found by bisection on height: a state from which the thin edge carries and the thick one does not.
    const State bat{0, 0, 0.55, 0, 31.0, 2.0, 0};
    CHECK(edge_carries(bat, 0.088));
    CHECK_FALSE(edge_carries(bat, 0.046));
}

TEST_CASE("the stumps are hit when any part of the ball overlaps them") {
    CHECK(hits_stumps(0.0, 0.40));
    CHECK(hits_stumps(kStumpHalfWidth + 0.035, 0.40));
    CHECK_FALSE(hits_stumps(kStumpHalfWidth + 0.037, 0.40));
    CHECK(hits_stumps(0.0, kStumpHeight + 0.035));
    CHECK_FALSE(hits_stumps(0.0, kStumpHeight + 0.037));
}

TEST_CASE("the mean delivery at the stumps is bowled if left and middled if played") {
    const Conditions c = quiet();
    const DeliveryResult r = simulate_delivery(release_to(5.0, 0.0, c), c.cs_mean, 0.0, c);
    REQUIRE(std::abs(r.stumps.x) < 0.1);
    CHECK(r.leave == LeaveOutcome::Bowled);
    CHECK(r.play == PlayOutcome::Middled);
}

TEST_CASE("the batter expects the mean delivery exactly") {
    const Conditions c = quiet();
    for (double length : {2.0, 4.0, kGoodLength, 9.0}) {
        const DeliveryResult r = simulate_delivery(release_to(length, 0.23, c), c.cs_mean, 0.0, c);
        INFO("length " << length);
        CHECK(std::abs(r.bat.x - r.expected_x) < 5e-4);
    }
}

TEST_CASE("only movement after the commit point opens a gap") {
    const Conditions c = quiet();
    const double seam = 0.02;
    // Good length: the bounce comes after the commit point, so the batter is beaten.
    const DeliveryResult late = simulate_delivery(release_to(kGoodLength, 0.23, c), c.cs_mean, seam, c);
    CHECK(std::abs(late.bat.x - late.expected_x) > 0.05);
    // Short and slow: the bounce comes before the commit point, so the batter has seen it.
    const DeliveryResult early = simulate_delivery(release_to(11.0, 0.23, c, 33.5), c.cs_mean, seam, c);
    CHECK(std::abs(early.bat.x - early.expected_x) < 2e-3);
}

// ---- Batches --------------------------------------------------------------------------------

namespace {

struct Run {
    BatchStorage batch;
    explicit Run(std::size_t n, std::uint64_t seed, const Conditions& c = Conditions{}) : batch(n) {
        batch.sample(ReleaseSpec{}, c, 99);
        OutcomeBatch out = batch.outcomes();
        simulate_batch(batch.releases(), c, seed, out);
    }
    Summary summary() const { return summarize(batch.leave.span(), batch.play.span()); }
};

bool same_bits(const Run& a, const Run& b) {
    const auto eq = [](auto x, auto y) { return std::memcmp(x.data(), y.data(), x.size_bytes()) == 0; };
    return eq(a.batch.bat_x.span(), b.batch.bat_x.span()) && eq(a.batch.bat_z.span(), b.batch.bat_z.span()) &&
           eq(a.batch.stumps_x.span(), b.batch.stumps_x.span()) && eq(a.batch.stumps_z.span(), b.batch.stumps_z.span()) &&
           eq(a.batch.expected_x.span(), b.batch.expected_x.span()) && eq(a.batch.bounce_x.span(), b.batch.bounce_x.span()) &&
           eq(a.batch.bounce_y.span(), b.batch.bounce_y.span()) && eq(a.batch.leave.span(), b.batch.leave.span()) &&
           eq(a.batch.play.span(), b.batch.play.span());
}

}  // namespace

TEST_CASE("a batch is bit-reproducible across thread counts") {
    const std::size_t n = 200'000;
#ifdef _OPENMP
    omp_set_num_threads(1);
    const Run one(n, 42);
    omp_set_num_threads(4);
    const Run four(n, 42);
    omp_set_num_threads(16);
    const Run sixteen(n, 42);
    omp_set_num_threads(omp_get_num_procs());
    CHECK(same_bits(one, four));
    CHECK(same_bits(one, sixteen));
#else
    const Run one(n, 42);
#endif
    CHECK(same_bits(one, Run(n, 42)));
    CHECK_FALSE(same_bits(one, Run(n, 43)));
}

TEST_CASE("every outcome appears in a realistic batch, with plausible rates") {
    const Summary s = Run(500'000, 1).summary();
    for (std::uint64_t count : s.play) CHECK(count > 0);
    CHECK(s.leave_bowled > 0);
    CHECK(s.p_middled() > 0.3);
    CHECK(s.p_wicket_play(1.0) < 0.25);
    CHECK(s.p_wicket_play(0.2) < s.p_wicket_play(1.0));
}

namespace {
double variance(const std::vector<double>& v) {
    double m = 0, s = 0;
    for (double x : v) m += x;
    m /= static_cast<double>(v.size());
    for (double x : v) s += (x - m) * (x - m);
    return s / static_cast<double>(v.size() - 1);
}
}  // namespace

TEST_CASE("common random numbers cut the noise of a comparison between nearby conditions") {
    // Two conditions that differ by a small step in vertical restitution, the kind of
    // step an optimiser takes. On the same seed the difference in dismissal probability
    // is far less noisy than on independent seeds.
    Conditions low, high;
    low.e_z = 0.55;
    high.e_z = 0.56;
    const std::size_t n = 20'000;
    std::vector<double> paired, independent;
    for (int r = 0; r < 40; ++r) {
        const double a = Run(n, 1000 + r, low).summary().p_wicket_play(1.0);
        paired.push_back(Run(n, 1000 + r, high).summary().p_wicket_play(1.0) - a);
        independent.push_back(Run(n, 5000 + r, high).summary().p_wicket_play(1.0) - a);
    }
    WARN("CRN variance ratio, nearby conditions: " << variance(independent) / variance(paired));
    CHECK(variance(paired) < 0.2 * variance(independent));
}

TEST_CASE("leave and play are compared on the same deliveries") {
    // EV(play) - EV(leave) from one batch (both actions on every delivery) against the
    // same difference taken from two independent batches.
    const double wicket_cost = 30.0, runs_middled = 0.6, catch_conversion = 0.2;
    const std::size_t n = 20'000;
    std::vector<double> paired, independent;
    for (int r = 0; r < 40; ++r) {
        const Summary a = Run(n, 2000 + r).summary(), b = Run(n, 7000 + r).summary();
        paired.push_back(a.ev_play(wicket_cost, runs_middled, catch_conversion) - a.ev_leave(wicket_cost));
        independent.push_back(a.ev_play(wicket_cost, runs_middled, catch_conversion) - b.ev_leave(wicket_cost));
    }
    WARN("CRN variance ratio, leave against play: " << variance(independent) / variance(paired));
    CHECK(variance(paired) < variance(independent));
}

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

TEST_CASE("Philox4x32-10 reproduces the Random123 known-answer vectors") {
    // Random123 kat_vectors: counter, key, expected output.
    STATIC_REQUIRE(philox4x32_10({0, 0, 0, 0}, {0, 0}) == PhiloxCounter{0x6627e8d5, 0xe169c58d, 0xbc57ac4c, 0x9b00dbd8});
    STATIC_REQUIRE(philox4x32_10({0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff}, {0xffffffff, 0xffffffff}) ==
                   PhiloxCounter{0x408f276d, 0x41c83b0e, 0xa20bc7c6, 0x6d5451fd});
    STATIC_REQUIRE(philox4x32_10({0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344}, {0xa4093822, 0x299f31d0}) ==
                   PhiloxCounter{0xd16cfe09, 0x94fdcceb, 0x5001e420, 0x24126ea1});
    // The same at run time, through the code path the batch uses.
    volatile std::uint32_t zero = 0;
    CHECK(philox4x32_10({zero, 0, 0, 0}, {0, 0}) == PhiloxCounter{0x6627e8d5, 0xe169c58d, 0xbc57ac4c, 0x9b00dbd8});
}

TEST_CASE("the branchless log and sincos match the standard library over every input the draws use") {
    // Inputs are unit32(w) for a 32-bit word w. Every 4099th word, plus both ends and the
    // neighbourhood of every quarter turn and of each power of two the log reduces across.
    std::vector<std::uint32_t> words;
    for (std::uint64_t w = 0; w <= 0xFFFFFFFFULL; w += 4099) words.push_back(static_cast<std::uint32_t>(w));
    for (std::uint32_t d = 0; d < 2'000; ++d) {
        words.push_back(d);
        words.push_back(0xFFFFFFFFu - d);
        for (std::uint32_t q = 1; q < 4; ++q) words.push_back(q * 0x40000000u + d - 1'000);
        for (int b = 1; b < 32; ++b) words.push_back((1u << b) + d - 1'000);  // unit32 near 2^(b-32)
    }
    double worst_log = 0, worst_sin = 0, worst_cos = 0;
    for (std::uint32_t w : words) {
        const double u = unit32(w);
        worst_log = std::max(worst_log, std::abs(log_branchless(u) - std::log(u)) / std::abs(std::log(u)));
        const SinCos sc = sincos_2pi_unit32(w);
        worst_sin = std::max(worst_sin, std::abs(sc.sin - std::sin(2.0 * kPi * u)));
        worst_cos = std::max(worst_cos, std::abs(sc.cos - std::cos(2.0 * kPi * u)));
    }
    INFO("worst relative log error " << worst_log << ", worst absolute sin " << worst_sin << ", cos " << worst_cos);
    CHECK(worst_log <= 0x1.0p-52);  // two units of 2^-53, relative
    CHECK(worst_sin <= 1e-15);      // absolute; std::sin(2 pi u) itself carries the rounding of 2 pi u
    CHECK(worst_cos <= 1e-15);
}

TEST_CASE("Box-Muller normals from Philox are standard normal") {
    const std::uint64_t n = 2'000'000;  // deliveries, three normals each
    double m1 = 0, m2 = 0, m3 = 0, m4 = 0, cross = 0;
    std::uint64_t tail = 0, deep = 0;
    for (std::uint64_t i = 0; i < n; ++i) {
        const std::array<double, 3> z = PhiloxBoxMuller::normals(2026, i);
        cross += z[0] * z[1];
        for (double x : z) {
            m1 += x, m2 += x * x, m3 += x * x * x, m4 += x * x * x * x;
            tail += std::abs(x) > ZigguratTables::kR;
            deep += std::abs(x) > 4.0;
        }
    }
    const double k = 3.0 * n;
    m1 /= k, m2 /= k, m3 /= k, m4 /= k;
    const double var = m2 - m1 * m1;
    const double skew = (m3 - 3 * m1 * m2 + 2 * m1 * m1 * m1) / std::pow(var, 1.5);
    const double kurt = (m4 - 4 * m1 * m3 + 6 * m1 * m1 * m2 - 3 * m1 * m1 * m1 * m1) / (var * var) - 3.0;
    // Bounds are about five standard errors on 6,000,000 draws.
    CHECK(std::abs(m1) < 0.002);
    CHECK(var == Approx(1.0).margin(0.003));
    CHECK(std::abs(skew) < 0.005);
    CHECK(std::abs(kurt) < 0.01);
    CHECK(std::abs(cross / n) < 0.004);  // the two normals of a Box-Muller pair are uncorrelated
    CHECK(static_cast<double>(tail) / k == Approx(5.76e-4).epsilon(0.10));  // 2 (1 - Phi(3.4426))
    CHECK(static_cast<double>(deep) / k == Approx(6.334e-5).epsilon(0.25));  // 2 (1 - Phi(4))
}

TEST_CASE("a Philox delivery's draws depend only on seed and delivery index, not on its block") {
    Conditions c;
    c.sigma_seam = 0.03;
    for (std::uint64_t first : {std::uint64_t{0}, std::uint64_t{5}, std::uint64_t{64}, std::uint64_t{1'000'003},
                                std::uint64_t{0xFFFFFFFFULL} - 7}) {
        for (std::size_t count : {std::size_t{1}, std::size_t{13}, kDrawBlock}) {
            DrawBlock b;
            draw_block<PhiloxBoxMuller>(77, first, count, c, b);  // the vectorised loop
            for (std::size_t j = 0; j < count; ++j) {
                const Draws d = PhiloxBoxMuller::draw(77, first + j, c);  // one delivery on its own
                INFO("delivery " << first + j);
                REQUIRE(std::memcmp(&d.cs, &b.cs[j], sizeof(double)) == 0);
                REQUIRE(std::memcmp(&d.seam_deviation, &b.seam_deviation[j], sizeof(double)) == 0);
                REQUIRE(std::memcmp(&d.e_z, &b.e_z[j], sizeof(double)) == 0);
            }
        }
    }
    CHECK(PhiloxBoxMuller::draw(77, 3, c).cs != PhiloxBoxMuller::draw(78, 3, c).cs);
    CHECK(PhiloxBoxMuller::draw(77, 3, c).cs != PhiloxBoxMuller::draw(77, 4, c).cs);
    CHECK(PhiloxBoxMuller::draw(77, 3, c).cs != PhiloxBoxMuller::draw(77, 3 + (std::uint64_t{1} << 32), c).cs);
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

template <typename Policy = XoshiroZiggurat>
struct Run {
    BatchStorage batch;
    explicit Run(std::size_t n, std::uint64_t seed, const Conditions& c = Conditions{}) : batch(n) {
        batch.sample(ReleaseSpec{}, c, 99);
        OutcomeBatch out = batch.outcomes();
        simulate_batch<Policy>(batch.releases(), c, seed, out);
    }
    Summary summary() const { return summarize(batch.leave.span(), batch.play.span()); }
};

template <typename Policy>
bool same_bits(const Run<Policy>& a, const Run<Policy>& b) {
    const auto eq = [](auto x, auto y) { return std::memcmp(x.data(), y.data(), x.size_bytes()) == 0; };
    return eq(a.batch.bat_x.span(), b.batch.bat_x.span()) && eq(a.batch.bat_z.span(), b.batch.bat_z.span()) &&
           eq(a.batch.stumps_x.span(), b.batch.stumps_x.span()) && eq(a.batch.stumps_z.span(), b.batch.stumps_z.span()) &&
           eq(a.batch.expected_x.span(), b.batch.expected_x.span()) && eq(a.batch.bounce_x.span(), b.batch.bounce_x.span()) &&
           eq(a.batch.bounce_y.span(), b.batch.bounce_y.span()) && eq(a.batch.leave.span(), b.batch.leave.span()) &&
           eq(a.batch.play.span(), b.batch.play.span());
}

}  // namespace

TEMPLATE_TEST_CASE("a batch is bit-reproducible across thread counts", "", XoshiroZiggurat, PhiloxBoxMuller) {
    const std::size_t n = 200'000;
#ifdef _OPENMP
    omp_set_num_threads(1);
    const Run<TestType> one(n, 42);
    omp_set_num_threads(4);
    const Run<TestType> four(n, 42);
    omp_set_num_threads(16);
    const Run<TestType> sixteen(n, 42);
    omp_set_num_threads(omp_get_num_procs());
    CHECK(same_bits(one, four));
    CHECK(same_bits(one, sixteen));
#else
    const Run<TestType> one(n, 42);
#endif
    CHECK(same_bits(one, Run<TestType>(n, 42)));
    CHECK_FALSE(same_bits(one, Run<TestType>(n, 43)));
}

TEMPLATE_TEST_CASE("a delivery's outcome does not depend on the size of its batch", "", XoshiroZiggurat,
                   PhiloxBoxMuller) {
    // Sizes that end mid-block and span several blocks; the releases are the same (seed 99) prefix.
    const Run<TestType> big(1'000, 8), small(37, 8), middle(130, 8);
    for (const Run<TestType>* r : {&small, &middle}) {
        const std::size_t n = r->batch.bat_x.span().size();
        const auto prefix = [n](auto a, auto b) { return std::memcmp(a.data(), b.data(), n * sizeof(a[0])) == 0; };
        CHECK(prefix(big.batch.bat_x.span(), r->batch.bat_x.span()));
        CHECK(prefix(big.batch.stumps_z.span(), r->batch.stumps_z.span()));
        CHECK(prefix(big.batch.expected_x.span(), r->batch.expected_x.span()));
        CHECK(prefix(big.batch.play.span(), r->batch.play.span()));
    }
}

TEST_CASE("the two random-number policies agree on outcome rates within sampling error") {
    Conditions windy, newlands, perth;
    windy.wind_x = 4.0, windy.wind_y = 1.0;
    newlands.sigma_seam = 0.03;
    perth.e_z = 0.62, perth.sigma_ez = 0.05, perth.cs_mean = 0.05;
    const std::size_t n = 400'000;
    for (const Conditions& c : {Conditions{}, windy, newlands, perth}) {
        const Summary a = Run<XoshiroZiggurat>(n, 3, c).summary(), b = Run<PhiloxBoxMuller>(n, 3, c).summary();
        const auto agree = [n](double p, double q) {
            const double m = 0.5 * (p + q);
            return std::abs(p - q) <= 5.0 * std::sqrt(2.0 * m * (1.0 - m) / static_cast<double>(n)) + 1e-12;
        };
        INFO("leave bowled " << a.p_wicket_leave() << " vs " << b.p_wicket_leave() << "; middled " << a.p_middled()
                             << " vs " << b.p_middled() << "; play wicket " << a.p_wicket_play(1.0) << " vs "
                             << b.p_wicket_play(1.0));
        CHECK(agree(a.p_wicket_leave(), b.p_wicket_leave()));
        CHECK(agree(a.p_middled(), b.p_middled()));
        CHECK(agree(a.p_wicket_play(1.0), b.p_wicket_play(1.0)));
        CHECK(a.p_wicket_play(1.0) != b.p_wicket_play(1.0));  // different streams, not the same numbers
    }
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

// ---- Cache-line layout ------------------------------------------------------------------------

TEST_CASE("per-thread counts and batch buffers start on their own cache lines") {
    STATIC_REQUIRE(alignof(PaddedSummary) == 64);
    STATIC_REQUIRE(sizeof(PaddedSummary) % 64 == 0);
    STATIC_REQUIRE(sizeof(Summary) % 64 != 0);  // why packed per-thread Summary slots would share lines
    const PaddedSummary slots[2]{};
    const auto at = [](const void* p) { return reinterpret_cast<std::uintptr_t>(p); };
    CHECK(at(&slots[0]) % 64 == 0);
    CHECK(at(&slots[1]) - at(&slots[0]) >= 64);

    BatchStorage batch(1'001);
    const OutcomeBatch out = batch.outcomes();
    const ReleaseBatch in = batch.releases();
    for (const double* p : {in.x.data(), in.z.data(), in.vx.data(), in.vy.data(), in.vz.data()}) CHECK(at(p) % 64 == 0);
    for (const double* p : {out.bat_x.data(), out.bat_z.data(), out.stumps_x.data(), out.stumps_z.data(),
                            out.expected_x.data(), out.bounce_x.data(), out.bounce_y.data()})
        CHECK(at(p) % 64 == 0);
    CHECK(at(out.leave.data()) % 64 == 0);
    CHECK(at(out.play.data()) % 64 == 0);
}

TEST_CASE("a batch's summary is identical on 1, 4 and 16 threads") {
    const std::size_t n = 100'000;
    const auto same = [](const Summary& a, const Summary& b) {
        return a.n == b.n && a.leave_bowled == b.leave_bowled && a.play == b.play;
    };
#ifdef _OPENMP
    omp_set_num_threads(1);
    const Summary one = Run(n, 11).summary();
    omp_set_num_threads(4);
    const Summary four = Run(n, 11).summary();
    omp_set_num_threads(16);
    const Summary sixteen = Run(n, 11).summary();
    omp_set_num_threads(omp_get_num_procs());
    CHECK(same(one, four));
    CHECK(same(one, sixteen));
#else
    const Summary one = Run(n, 11).summary();
#endif
    CHECK(one.n == n);
    CHECK_FALSE(same(one, Run(n, 12).summary()));
}

TEMPLATE_TEST_CASE("a batch split into pieces at any boundaries gives the same bits as one call", "", XoshiroZiggurat,
                   PhiloxBoxMuller) {
    const std::size_t n = 1'000;
    const Run<TestType> whole(n, 21);
    BatchStorage pieces(n);
    pieces.sample(ReleaseSpec{}, Conditions{}, 99);
    const ReleaseBatch in = pieces.releases();
    OutcomeBatch out = pieces.outcomes();
    for (const auto& [first, count] : {std::pair<std::size_t, std::size_t>{0, 37}, {37, 463}, {500, 1}, {501, 499}}) {
        const auto cut = [&](auto s) { return s.subspan(first, count); };
        const ReleaseBatch part{cut(in.x), cut(in.z), cut(in.vx), cut(in.vy), cut(in.vz)};
        OutcomeBatch o{cut(out.bat_x), cut(out.bat_z), cut(out.stumps_x), cut(out.stumps_z), cut(out.expected_x),
                       cut(out.bounce_x), cut(out.bounce_y), cut(out.leave), cut(out.play)};
        simulate_batch<TestType>(part, Conditions{}, 21, o, first);
    }
    const auto eq = [](auto x, auto y) { return std::memcmp(x.data(), y.data(), x.size_bytes()) == 0; };
    CHECK(eq(whole.batch.bat_x.span(), pieces.bat_x.span()));
    CHECK(eq(whole.batch.stumps_x.span(), pieces.stumps_x.span()));
    CHECK(eq(whole.batch.stumps_z.span(), pieces.stumps_z.span()));
    CHECK(eq(whole.batch.expected_x.span(), pieces.expected_x.span()));
    CHECK(eq(whole.batch.bounce_y.span(), pieces.bounce_y.span()));
    CHECK(eq(whole.batch.leave.span(), pieces.leave.span()));
    CHECK(eq(whole.batch.play.span(), pieces.play.span()));
}

// ---- Named lengths ----------------------------------------------------------------------------

TEST_CASE("the named lengths are inside the envelope, and good length is the showcase delivery's") {
    for (const DeliveryLength l :
         {DeliveryLength::GoodLength, DeliveryLength::FourthStumpYorker, DeliveryLength::FourthStumpBouncer}) {
        CHECK(length_of(l) >= envelope::kMinLength);
        CHECK(length_of(l) <= envelope::kMaxLength);
    }
    CHECK(length_of(DeliveryLength::GoodLength) == kGoodLength);  // the baseline does not move
    const BouncePoint b = bounce_target(DeliveryLength::GoodLength, 0.75, 0.0, Conditions{});
    CHECK(b.x == 0.0 + (0.75 - 0.0) * kGoodLength / Conditions{}.release_y);
    CHECK(b.y == kGoodLength);
}

// Aimed as the showcase is (no swing, no wind), then flown under any swing in the envelope and
// along-pitch wind: where each named length's mean delivery bounces, as distance from release.
TEST_CASE("each named length's mean delivery bounces in its band; the yorker reaches the stumps on the full") {
    using namespace envelope;
    Conditions neutral = quiet();
    neutral.cs_mean = 0.0;
    for (double speed : {kMinSpeed, 0.5 * (kMinSpeed + kMaxSpeed), kMaxSpeed})
    for (double release_x : {0.75, -0.75})
    for (double cs : {-kMaxSwing, 0.0, kMaxSwing})
    for (double wind_y : {-3.0, 0.0, 3.0}) {
        Conditions c = quiet();
        c.cs_mean = cs;
        c.wind_y = wind_y;
        const auto fly = [&](DeliveryLength l) {
            const BouncePoint b = bounce_target(l, release_x, 0.0, neutral);
            return make_flight(release_state(aim(release_x, 2.08, speed, b.x, b.y, neutral)), cs, 0.0, c, pitch_of(c));
        };
        INFO("speed " << speed << ", release x " << release_x << ", swing " << cs << ", wind along " << wind_y);
        const Flight good = fly(DeliveryLength::GoodLength), bouncer = fly(DeliveryLength::FourthStumpBouncer),
                     yorker = fly(DeliveryLength::FourthStumpYorker);
        REQUIRE(good.bounced);
        CHECK(good.bounce_s == Approx(c.release_y - kGoodLength).margin(0.35));  // 12.4 m, short of 13.5 to 15
        REQUIRE(bouncer.bounced);
        CHECK(bouncer.bounce_s >= 9.5);
        CHECK(bouncer.bounce_s <= 11.0);
        CHECK_FALSE(yorker.bounced);
        const State at_bat = yorker.at(c.release_y - kBatPlaneY), at_stumps = yorker.at(c.release_y);
        CHECK(at_bat.z < 0.45);  // below the knee at the popping crease
        CHECK(at_stumps.z < 0.2);  // the bottom of the stumps
    }
}

// WebAssembly entry points for the page's live panel (ADR-016): a thin, single-threaded
// caller of the engine header. Every buffer is static, so nothing is allocated.
//
// Protocol: the caller writes kInputCount doubles at live_inputs(), then
//   live_simulate(first, count, seed)  deliveries [first, first + count) of a batch: outcome counts
//                                      at live_counts(), arrivals of indices below 256 at live_arrivals()
//   live_summarize()                   probabilities and expected values from the counts at
//                                      live_counts() (written by the caller after merging), and the
//                                      mean delivery's path
//   live_sample(index, seed)           one delivery of the batch, its outcome and path
// Each returns 0, or 1 + the index of the first input outside the envelope, or kBadCount.
// Deliveries are index-addressed, so splitting a batch across instances changes nothing.
#include <algorithm>
#include <cmath>
#include <cstdint>

#include "fourth_stump_envelope.hpp"

using namespace fs;

namespace {

constexpr std::size_t kCapacity = 1'000'000;  // most deliveries per batch
constexpr std::size_t kBlock = 4096;          // deliveries simulated per engine call
constexpr std::size_t kArrivals = 256;
constexpr int kTracePoints = 48;  // as trace() in the Python binding, plus the bounce point

// Input layout. Conditions fields first (everything but cs_mean and wind_x), then the release,
// then the run's own settings.
enum Input {
    kSigmaSwing, kSigmaSeam, kEz, kSigmaEz, kPaceRetention, kTilt, kWindY, kReleaseY, kReactionTime,
    kReleaseX, kReleaseZ, kLine, kLength,
    kSpeedKmh, kSwing, kCrosswind, kWicketCost, kRunsMiddled, kCatchConversion,
    kInputCount
};
constexpr int kBadCount = 100;

enum Count { kN, kLeaveBowled, kPlay0, kCountCount = kPlay0 + 5 };
enum Output {
    kPWicketLeave, kPWicketPlay, kPMiddled, kPEdged, kPEdgedCarried, kPMissed, kEvLeave, kEvPlay,
    kBounceIndex, kPathPoints, kLeave, kPlay, kCaught, kStumpsX, kStumpsZ, kOutputCount
};

double inputs[kInputCount];
double counts[kCountCount];  // integers, exact in a double up to 2^53
double outputs[kOutputCount];
double arrivals[2 * kArrivals];
double path[3 * (kTracePoints + 1)];

alignas(64) double rel_x[kBlock], rel_z[kBlock], rel_vx[kBlock], rel_vy[kBlock], rel_vz[kBlock];
alignas(64) double bat_x[kBlock], bat_z[kBlock], stumps_x[kBlock], stumps_z[kBlock];
alignas(64) double expected_x[kBlock], bounce_x[kBlock], bounce_y[kBlock];
alignas(64) std::uint8_t leave[kBlock], play[kBlock];

bool within(double v, double lo, double hi) { return std::isfinite(v) && v >= lo && v <= hi; }

// 0 if every input is inside the envelope (fourth_stump_envelope.hpp) and physically meaningful,
// else 1 + the index of the first that is not.
int check() {
    using namespace envelope;
    const double* in = inputs;
    const auto bad = [](int i) { return 1 + i; };
    for (int i = 0; i < kInputCount; ++i)
        if (!std::isfinite(in[i])) return bad(i);
    for (int i : {kSigmaSwing, kSigmaSeam, kSigmaEz, kWicketCost, kRunsMiddled})
        if (in[i] < 0.0) return bad(i);
    if (!within(in[kEz], 0.0, 1.0)) return bad(kEz);
    if (!within(in[kPaceRetention], 0.0, 1.0)) return bad(kPaceRetention);
    if (!within(in[kCatchConversion], 0.0, 1.0)) return bad(kCatchConversion);
    // Tilt, release distance and line have no envelope constant; these are sanity bounds well outside every venue.
    if (!within(in[kTilt], -0.1, 0.1)) return bad(kTilt);
    if (!within(in[kReleaseY], 15.0, kPitchLength)) return bad(kReleaseY);
    if (!within(in[kLine], -1.0, 1.0)) return bad(kLine);
    if (!(in[kReactionTime] > 0.0)) return bad(kReactionTime);
    if (!within(std::abs(in[kReleaseX]), 0.0, kMaxReleaseX)) return bad(kReleaseX);
    if (!within(in[kReleaseZ], kMinReleaseZ, kMaxReleaseZ)) return bad(kReleaseZ);
    if (in[kLength] != 0.0 && in[kLength] != 1.0 && in[kLength] != 2.0) return bad(kLength);
    if (!within(in[kSpeedKmh] / 3.6, kMinSpeed, kMaxSpeed)) return bad(kSpeedKmh);
    if (!within(in[kSwing], -kMaxSwing, kMaxSwing)) return bad(kSwing);
    if (!within(in[kCrosswind], -kMaxWind, kMaxWind)) return bad(kCrosswind);
    if (!within(in[kWindY], -kMaxWind, kMaxWind)) return bad(kWindY);
    if (std::hypot(in[kCrosswind], in[kWindY]) > kMaxWind) return bad(kCrosswind);  // the envelope bounds wind speed
    return 0;
}

Conditions conditions() {
    Conditions c;
    c.cs_mean = inputs[kSwing];
    c.sigma_swing = inputs[kSigmaSwing];
    c.sigma_seam = inputs[kSigmaSeam];
    c.e_z = inputs[kEz];
    c.sigma_ez = inputs[kSigmaEz];
    c.pace_retention = inputs[kPaceRetention];
    c.tilt = inputs[kTilt];
    c.wind_x = inputs[kCrosswind];
    c.wind_y = inputs[kWindY];
    c.release_y = inputs[kReleaseY];
    c.reaction_time = inputs[kReactionTime];
    return c;
}

// The release, aimed as the exporter aims the showcase: no swing, no wind, at this speed and length.
Release release(const Conditions& c) {
    Conditions neutral;
    neutral.cs_mean = 0.0;
    neutral.release_y = c.release_y;
    const BouncePoint b = bounce_target(static_cast<DeliveryLength>(inputs[kLength]), inputs[kReleaseX], inputs[kLine], neutral);
    return aim(inputs[kReleaseX], inputs[kReleaseZ], inputs[kSpeedKmh] / 3.6, b.x, b.y, neutral);
}

// A delivery's path in data coordinates, as trace() in the Python binding: kTracePoints even
// stations with the bounce point spliced in before the first station at or past it.
void trace(const Release& r, double cs, double seam, const Conditions& c, double e_z) {
    Pitch pitch = pitch_of(c);
    pitch.e_z = e_z;
    const Flight f = make_flight(release_state(r), cs, seam, c, pitch);
    int bounce_index = -1, out = 0;
    const auto put = [&](const State& st) {
        path[3 * out] = st.x, path[3 * out + 1] = c.release_y - st.s, path[3 * out + 2] = st.z;
        ++out;
    };
    for (int i = 0; i < kTracePoints; ++i) {
        const double s = c.release_y * i / (kTracePoints - 1);
        if (f.bounced && bounce_index < 0 && s >= f.bounce_s) {
            bounce_index = out;
            put(f.bounce_out);
        }
        put(f.at(s));
    }
    outputs[kBounceIndex] = bounce_index;
    outputs[kPathPoints] = out;
}

}  // namespace

extern "C" {

double* live_inputs() { return inputs; }
double* live_counts() { return counts; }
double* live_outputs() { return outputs; }
double* live_arrivals() { return arrivals; }
double* live_path() { return path; }
int live_capacity() { return static_cast<int>(kCapacity); }
int live_check() { return check(); }

// Envelope limits for the controls: 0, 1 speed in km/h; 2, 3 mean swing; 4, 5 crosswind in m/s.
double live_limit(int i) {
    using namespace envelope;
    const double limits[] = {kMinSpeed * 3.6, kMaxSpeed * 3.6, -kMaxSwing, kMaxSwing, -kMaxWind, kMaxWind};
    return i >= 0 && i < 6 ? limits[i] : NAN;
}

// DeliveryLength i's bounce distance from the batter's stumps.
double live_length(int i) { return i >= 0 && i < 3 ? length_of(static_cast<DeliveryLength>(i)) : NAN; }
double live_release_y() { return Conditions{}.release_y; }

int live_simulate(int first, int count, std::uint32_t seed) {
    if (first < 0 || count < 1 || static_cast<std::size_t>(first) + static_cast<std::size_t>(count) > kCapacity) return kBadCount;
    if (const int error = check()) return error;
    const Conditions c = conditions();
    const Release r = release(c);
    std::fill_n(rel_x, kBlock, r.x), std::fill_n(rel_z, kBlock, r.z);
    std::fill_n(rel_vx, kBlock, r.vx), std::fill_n(rel_vy, kBlock, r.vy), std::fill_n(rel_vz, kBlock, r.vz);
    Summary total;
    for (std::size_t done = 0; done < static_cast<std::size_t>(count); done += kBlock) {
        const std::size_t m = std::min(kBlock, static_cast<std::size_t>(count) - done), index = static_cast<std::size_t>(first) + done;
        const ReleaseBatch in{{rel_x, m}, {rel_z, m}, {rel_vx, m}, {rel_vy, m}, {rel_vz, m}};
        OutcomeBatch out{{bat_x, m}, {bat_z, m}, {stumps_x, m}, {stumps_z, m}, {expected_x, m},
                         {bounce_x, m}, {bounce_y, m}, {leave, m}, {play, m}};
        simulate_batch(in, c, seed, out, index);
        const Summary s = summarize({leave, m}, {play, m});
        total.n += s.n, total.leave_bowled += s.leave_bowled;
        for (std::size_t k = 0; k < s.play.size(); ++k) total.play[k] += s.play[k];
        for (std::size_t j = 0; j < m && index + j < kArrivals; ++j)
            arrivals[2 * (index + j)] = stumps_x[j], arrivals[2 * (index + j) + 1] = stumps_z[j];
    }
    counts[kN] = static_cast<double>(total.n);
    counts[kLeaveBowled] = static_cast<double>(total.leave_bowled);
    for (std::size_t k = 0; k < total.play.size(); ++k) counts[kPlay0 + k] = static_cast<double>(total.play[k]);
    return 0;
}

int live_summarize() {
    if (const int error = check()) return error;
    if (!(counts[kN] >= 1.0)) return kBadCount;
    Summary s;
    s.n = static_cast<std::uint64_t>(counts[kN]);
    s.leave_bowled = static_cast<std::uint64_t>(counts[kLeaveBowled]);
    for (std::size_t k = 0; k < s.play.size(); ++k) s.play[k] = static_cast<std::uint64_t>(counts[kPlay0 + k]);
    const double n = counts[kN], cc = inputs[kCatchConversion], cost = inputs[kWicketCost];
    outputs[kPWicketLeave] = s.p_wicket_leave();
    outputs[kPWicketPlay] = s.p_wicket_play(cc);
    outputs[kPMiddled] = s.p_middled();
    outputs[kPEdged] = static_cast<double>(s.play[1] + s.play[2]) / n;
    outputs[kPEdgedCarried] = static_cast<double>(s.play[2]) / n;
    outputs[kPMissed] = static_cast<double>(s.play[3] + s.play[4]) / n;
    outputs[kEvLeave] = s.ev_leave(cost);
    outputs[kEvPlay] = s.ev_play(cost, inputs[kRunsMiddled], cc);
    const Conditions c = conditions();
    trace(release(c), c.cs_mean, 0.0, c, c.e_z);  // the mean delivery: mean swing, no seam deviation
    return 0;
}

int live_sample(int index, std::uint32_t seed) {
    if (index < 0 || static_cast<std::size_t>(index) >= kCapacity) return kBadCount;
    if (const int error = check()) return error;
    const Conditions c = conditions();
    const Release r = release(c);
    const auto i = static_cast<std::uint64_t>(index);
    const Draws d = XoshiroZiggurat::draw(seed, i, c);  // the batch's draws for this delivery
    const DeliveryResult res = simulate_delivery(r, d.cs, d.seam_deviation, c, pitch_of(c), d.e_z);
    outputs[kLeave] = static_cast<double>(res.leave);
    outputs[kPlay] = static_cast<double>(res.play);
    // A carrying edge is caught with the catch conversion; stream 2 is free (1 samples releases).
    Rng catcher(seed, i, 2);
    outputs[kCaught] = res.play == PlayOutcome::EdgedCarried && catcher.uniform() < inputs[kCatchConversion] ? 1.0 : 0.0;
    outputs[kStumpsX] = res.stumps.x;
    outputs[kStumpsZ] = res.stumps.z;
    trace(r, d.cs, d.seam_deviation, c, d.e_z);
    return 0;
}

}  // extern "C"

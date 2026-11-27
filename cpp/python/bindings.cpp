// Python binding: a thin caller of the engine header (ADR-012). NumPy arrays in and out.
// pybind11 first: Python.h sets feature-test macros and must come before any standard header.
#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "fourth_stump_envelope.hpp"

namespace py = pybind11;
using namespace fs;
using Array = py::array_t<double, py::array::c_style | py::array::forcecast>;
using Bytes = py::array_t<std::uint8_t>;

namespace {

std::span<const double> view(const Array& a) { return {a.data(), static_cast<std::size_t>(a.size())}; }
std::span<double> view(Array& a) { return {a.mutable_data(), static_cast<std::size_t>(a.size())}; }

// The engine does not validate its inputs; this is the trust boundary.
void check_release(const Release& r, const Conditions& c) {
    const bool finite = std::isfinite(r.x) && std::isfinite(r.z) && std::isfinite(r.vx) && std::isfinite(r.vy) &&
                        std::isfinite(r.vz);
    if (!finite) throw py::value_error("release values must be finite");
    if (r.z <= kBallRadius) throw py::value_error("release must start above the pitch");
    if (-r.vy <= std::abs(c.wind_y) + 1.0) throw py::value_error("release must travel down the pitch (vy < 0) faster than the wind");
}

Release release_of(const std::array<double, 5>& r, const Conditions& c) {
    const Release release{r[0], r[1], r[2], r[3], r[4]};
    check_release(release, c);
    return release;
}

py::dict sample(const ReleaseSpec& spec, const Conditions& c, std::size_t n, std::uint64_t seed) {
    Array x(n), z(n), vx(n), vy(n), vz(n);
    sample_releases(spec, c, seed, view(x), view(z), view(vx), view(vy), view(vz));
    py::dict d;
    d["x"] = x, d["z"] = z, d["vx"] = vx, d["vy"] = vy, d["vz"] = vz;
    return d;
}

py::dict simulate(const Array& x, const Array& z, const Array& vx, const Array& vy, const Array& vz,
                  const Conditions& c, std::uint64_t seed, int threads) {
    const auto n = static_cast<std::size_t>(x.size());
    for (const Array* a : {&z, &vx, &vy, &vz})
        if (static_cast<std::size_t>(a->size()) != n) throw py::value_error("release arrays must have equal length");
    for (std::size_t i = 0; i < n; ++i) check_release({x.at(i), z.at(i), vx.at(i), vy.at(i), vz.at(i)}, c);
    Array bat_x(n), bat_z(n), stumps_x(n), stumps_z(n), expected_x(n), bounce_x(n), bounce_y(n);
    Bytes leave(n), play(n);
    OutcomeBatch out{view(bat_x), view(bat_z), view(stumps_x), view(stumps_z), view(expected_x), view(bounce_x),
                     view(bounce_y), {leave.mutable_data(), n}, {play.mutable_data(), n}};
    const ReleaseBatch in{view(x), view(z), view(vx), view(vy), view(vz)};
    {
        py::gil_scoped_release release;
#ifdef _OPENMP
        omp_set_num_threads(threads > 0 ? threads : omp_get_num_procs());  // 0 means every core, on every call
#else
        (void)threads;
#endif
        simulate_batch(in, c, seed, out);
    }
    py::dict d;
    d["bat_x"] = bat_x, d["bat_z"] = bat_z, d["stumps_x"] = stumps_x, d["stumps_z"] = stumps_z;
    d["expected_x"] = expected_x, d["bounce_x"] = bounce_x, d["bounce_y"] = bounce_y;
    d["leave"] = leave, d["play"] = play;
    return d;
}

// One delivery with explicit swing coefficient and seam deviation: its outcome and
// `points` positions along the path (x, y, z, t), with the bounce point spliced in.
py::dict trace(const std::array<double, 5>& release, double cs, double seam, const Conditions& c, int points) {
    if (points < 2) throw py::value_error("points must be at least 2");
    const Release r = release_of(release, c);
    const Flight f = make_flight(release_state(r), cs, seam, c, pitch_of(c));
    std::vector<double> stations;
    for (int i = 0; i < points; ++i) stations.push_back(c.release_y * i / (points - 1));
    py::ssize_t bounce_index = -1;
    if (f.bounced) {
        const auto it = std::lower_bound(stations.begin(), stations.end(), f.bounce_s);
        bounce_index = it - stations.begin();
        stations.insert(it, f.bounce_s);
    }
    py::array_t<double> path({static_cast<py::ssize_t>(stations.size()), py::ssize_t{4}});
    auto p = path.mutable_unchecked<2>();
    for (std::size_t i = 0; i < stations.size(); ++i) {
        const bool at_bounce = static_cast<py::ssize_t>(i) == bounce_index;
        const State st = at_bounce ? f.bounce_out : f.at(stations[i]);
        const auto row = static_cast<py::ssize_t>(i);
        p(row, 0) = st.x, p(row, 1) = c.release_y - st.s, p(row, 2) = st.z, p(row, 3) = st.t;
    }
    const DeliveryResult res = simulate_delivery(r, cs, seam, c);
    py::dict d;
    d["path"] = path;
    d["bounce_index"] = bounce_index;
    d["bat"] = py::make_tuple(res.bat.x, res.bat.z);
    d["stumps"] = py::make_tuple(res.stumps.x, res.stumps.z);
    d["expected_x"] = res.expected_x;
    d["leave"] = static_cast<int>(res.leave);
    d["play"] = static_cast<int>(res.play);
    return d;
}

py::dict reference_arrival(const std::array<double, 5>& release, double cs, double seam, const Conditions& c, double dt) {
    if (!(dt > 0.0)) throw py::value_error("dt must be positive");
    const reference::Path p = reference::fly(release_of(release, c), cs, seam, c, dt);
    py::dict d;
    d["bat"] = py::make_tuple(p.bat.x, p.bat.z);
    d["stumps"] = py::make_tuple(p.stumps.x, p.stumps.z);
    return d;
}

}  // namespace

PYBIND11_MODULE(_engine, m) {
    m.doc() = "Fourth Stump EV engine";

    py::class_<Conditions>(m, "Conditions")
        .def(py::init<>())
        .def_readwrite("cs_mean", &Conditions::cs_mean)
        .def_readwrite("sigma_swing", &Conditions::sigma_swing)
        .def_readwrite("sigma_seam", &Conditions::sigma_seam)
        .def_readwrite("e_z", &Conditions::e_z)
        .def_readwrite("sigma_ez", &Conditions::sigma_ez)
        .def_readwrite("pace_retention", &Conditions::pace_retention)
        .def_readwrite("tilt", &Conditions::tilt)
        .def_readwrite("wind_x", &Conditions::wind_x)
        .def_readwrite("wind_y", &Conditions::wind_y)
        .def_readwrite("release_y", &Conditions::release_y)
        .def_readwrite("reaction_time", &Conditions::reaction_time);

    py::class_<ReleaseSpec>(m, "ReleaseSpec")
        .def(py::init<>())
        .def_readwrite("x", &ReleaseSpec::x)
        .def_readwrite("z", &ReleaseSpec::z)
        .def_readwrite("speed_mean", &ReleaseSpec::speed_mean)
        .def_readwrite("speed_sd", &ReleaseSpec::speed_sd)
        .def_readwrite("length_mean", &ReleaseSpec::length_mean)
        .def_readwrite("length_sd", &ReleaseSpec::length_sd)
        .def_readwrite("line_mean", &ReleaseSpec::line_mean)
        .def_readwrite("line_sd", &ReleaseSpec::line_sd);

    m.def("sample_releases", &sample, py::arg("spec"), py::arg("conditions"), py::arg("n"), py::arg("seed"));
    m.def("simulate", &simulate, py::arg("x"), py::arg("z"), py::arg("vx"), py::arg("vy"), py::arg("vz"),
          py::arg("conditions"), py::arg("seed"), py::arg("threads") = 0);
    m.def("aim", [](double x, double z, double speed, double bounce_x, double bounce_y, const Conditions& c) {
        const Release r = aim(x, z, speed, bounce_x, bounce_y, c);
        return std::array<double, 5>{r.x, r.z, r.vx, r.vy, r.vz};
    });
    m.def("trace", &trace, py::arg("release"), py::arg("cs"), py::arg("seam_deviation"), py::arg("conditions"),
          py::arg("points") = 48);
    m.def("reference_arrival", &reference_arrival, py::arg("release"), py::arg("cs"), py::arg("seam_deviation"),
          py::arg("conditions"), py::arg("dt") = 1e-4);

    py::dict k;
    k["pitch_length"] = kPitchLength, k["stump_half_width"] = kStumpHalfWidth, k["stump_height"] = kStumpHeight;
    k["ball_radius"] = kBallRadius, k["bat_plane_y"] = kBatPlaneY, k["bat_half_width"] = kBatHalfWidth;
    k["edge_inner_margin"] = kEdgeInnerMargin, k["corridor_min"] = kCorridorMin, k["corridor_max"] = kCorridorMax;
    k["aero_k"] = kAeroK, k["pace_retention"] = kPaceRetention, k["reaction_time"] = kReactionTime;
    k["min_speed"] = envelope::kMinSpeed, k["max_speed"] = envelope::kMaxSpeed, k["max_swing"] = envelope::kMaxSwing;
    k["max_wind"] = envelope::kMaxWind, k["published_bound"] = envelope::kPublishedBound;
    k["max_release_x"] = envelope::kMaxReleaseX, k["min_release_z"] = envelope::kMinReleaseZ;
    k["max_release_z"] = envelope::kMaxReleaseZ, k["min_length"] = envelope::kMinLength, k["max_length"] = envelope::kMaxLength;
    m.attr("CONSTANTS") = k;
    m.attr("LEAVE_OUTCOMES") = std::vector<std::string>{"safe", "bowled"};
    m.attr("PLAY_OUTCOMES") = std::vector<std::string>{"middled", "edged_safe", "edged_carried", "missed", "missed_bowled"};
}

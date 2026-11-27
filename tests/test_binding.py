"""The engine through its Python binding, including property-based checks against the reference trajectory."""
import math

import numpy as np
from hypothesis import given, settings
from hypothesis import strategies as st

import fourth_stump as fs

K = fs.CONSTANTS
SLOPE = math.radians(1.09)


def run_batch(n=20_000, seed=1, threads=0, conditions=None):
    c = conditions or fs.Conditions()
    releases = fs.sample_releases(fs.ReleaseSpec(), c, n, 99)
    return fs.simulate(**releases, conditions=c, seed=seed, threads=threads)


def make_conditions(**fields):
    c = fs.Conditions()
    for name, value in fields.items():
        setattr(c, name, value)
    return c


def test_a_batch_is_bit_reproducible_across_thread_counts():
    one, four, sixteen = (run_batch(threads=t) for t in (1, 4, 16))
    for key in one:
        assert one[key].tobytes() == four[key].tobytes() == sixteen[key].tobytes(), key


def test_a_different_seed_changes_the_outcomes():
    assert run_batch(seed=1)["bat_x"].tobytes() != run_batch(seed=2)["bat_x"].tobytes()


def test_outcome_codes_follow_the_geometry():
    out = run_batch(100_000)
    gap = np.abs(out["bat_x"] - out["expected_x"])
    hits = (np.abs(out["stumps_x"]) <= K["stump_half_width"] + K["ball_radius"]) & (
        out["stumps_z"] <= K["stump_height"] + K["ball_radius"])
    inner = K["bat_half_width"] - K["edge_inner_margin"]
    outer = K["bat_half_width"] + K["ball_radius"]
    assert np.array_equal(out["leave"] == 1, hits)
    assert np.array_equal(out["play"] == 0, gap < inner)
    assert np.array_equal(np.isin(out["play"], (1, 2)), (gap >= inner) & (gap < outer))
    assert np.array_equal(out["play"] == 4, (gap >= outer) & hits)


def test_summary_probabilities_cover_every_delivery():
    summary = fs.summarize(run_batch())
    assert math.isclose(sum(summary[name] for name in fs.PLAY_OUTCOMES), 1.0)
    assert 0.0 < summary["p_wicket_play"] < 0.5


def test_swing_fades_with_ball_age_and_reverses_for_a_left_armer():
    new, old = fs.conditions_for("lords", ball_age=1), fs.conditions_for("lords", ball_age=80)
    assert new.cs_mean > old.cs_mean > 0
    assert fs.conditions_for("lords", arm="left").cs_mean == -new.cs_mean
    # A Kookaburra loses its swing sooner than a Dukes.
    assert (fs.conditions_for("perth", 40).cs_mean / fs.conditions_for("perth", 1).cs_mean
            < old.cs_mean / new.cs_mean)


def test_the_other_bowling_end_reverses_the_slope_and_the_wind():
    pavilion, nursery = fs.conditions_for("lords", end=0), fs.conditions_for("lords", end=1)
    assert pavilion.tilt < 0 < nursery.tilt  # into a right-hander from the Pavilion End
    assert nursery.tilt == -pavilion.tilt and nursery.wind_x == -pavilion.wind_x


envelope_delivery = st.fixed_dictionaries({
    "speed": st.floats(K["min_speed"], K["max_speed"]),
    "length": st.floats(1.0, 10.0),
    "line": st.floats(-0.2, 0.6),
    "release_x": st.sampled_from([0.45, -0.45]),
    "cs": st.floats(-K["max_swing"], K["max_swing"]),
    "seam": st.floats(-0.03, 0.03),
    "e_z": st.floats(0.46, 0.65),
    "tilt": st.floats(-SLOPE, SLOPE),
    "wind": st.floats(0.0, K["max_wind"]),
    "heading": st.floats(0.0, 2 * math.pi),
})


def build(d):
    c = make_conditions(cs_mean=d["cs"], e_z=d["e_z"], tilt=d["tilt"],
                        wind_x=d["wind"] * math.cos(d["heading"]), wind_y=d["wind"] * math.sin(d["heading"]))
    bounce_x = d["line"] + (d["release_x"] - d["line"]) * d["length"] / c.release_y
    return fs.aim(d["release_x"], 2.10, d["speed"], bounce_x, d["length"], c), c


@settings(max_examples=400, deadline=None)
@given(envelope_delivery)
def test_the_kernel_stays_inside_its_published_bound_anywhere_in_the_envelope(d):
    release, c = build(d)
    kernel = fs.trace(release, d["cs"], d["seam"], c)
    reference = fs.reference_arrival(release, d["cs"], d["seam"], c, 2e-4)
    for plane in ("bat", "stumps"):
        assert math.dist(kernel[plane], reference[plane]) <= K["published_bound"], plane


@settings(max_examples=200, deadline=None)
@given(envelope_delivery)
def test_mirroring_a_delivery_mirrors_its_arrival(d):
    release, c = build(d)
    mirrored_c = make_conditions(cs_mean=-c.cs_mean, e_z=c.e_z, tilt=-c.tilt, wind_x=-c.wind_x, wind_y=c.wind_y)
    x, z, vx, vy, vz = release
    a = fs.trace(release, d["cs"], d["seam"], c)
    b = fs.trace([-x, z, -vx, vy, vz], -d["cs"], -d["seam"], mirrored_c)
    for plane in ("bat", "stumps"):
        assert math.isclose(a[plane][0], -b[plane][0], abs_tol=1e-9)
        assert math.isclose(a[plane][1], b[plane][1], abs_tol=1e-9)
    assert a["leave"] == b["leave"] and a["play"] == b["play"]

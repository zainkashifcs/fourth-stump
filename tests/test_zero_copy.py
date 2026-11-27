"""Batch: views of the engine's aligned storage, and engine calls that release the GIL (ADR-015)."""
import gc
import os
import threading
import time

import numpy as np
import pytest

import fourth_stump as fs
from fourth_stump._engine import Batch

OUTCOMES = ("bat_x", "bat_z", "stumps_x", "stumps_z", "expected_x", "bounce_x", "bounce_y", "leave", "play")
RELEASES = ("x", "z", "vx", "vy", "vz")


def sampled_batch(n=20_000, seed=99, conditions=None):
    batch = Batch(n)
    batch.sample(fs.ReleaseSpec(), conditions or fs.Conditions(), seed)
    return batch


def test_views_of_one_buffer_share_memory_with_each_other_and_with_their_storage():
    batch = sampled_batch()
    first, second = batch.simulate(fs.Conditions(), seed=1), batch.outcomes()
    for key in OUTCOMES:
        assert np.shares_memory(first[key], second[key]), key
        assert first[key].base is batch, key
    assert np.shares_memory(batch.x, batch.x) and batch.x.base is batch
    assert not np.shares_memory(first["bat_x"], first["bat_z"])


def test_every_view_starts_on_a_64_byte_boundary():
    batch = sampled_batch(1_001)  # an odd size, so alignment is not an accident of the length
    views = [*batch.simulate(fs.Conditions(), seed=1).values(), *(getattr(batch, k) for k in RELEASES)]
    assert all(v.ctypes.data % 64 == 0 for v in views)


def test_outcome_views_are_read_only_and_release_views_are_writeable():
    batch = sampled_batch(10)
    out = batch.simulate(fs.Conditions(), seed=1)
    with pytest.raises(ValueError, match="read-only"):
        out["bat_x"][0] = 0.0
    batch.x[0] = batch.x[0]


def test_views_outlive_the_batch_that_produced_them():
    batch = sampled_batch()
    out, x = batch.simulate(fs.Conditions(), seed=1), batch.x
    expected = {key: value.copy() for key, value in out.items()}
    del batch
    gc.collect()
    _ = [np.ones(20_000) for _ in range(50)]  # churn the heap so freed storage would be reused
    for key in OUTCOMES:
        assert out[key].tobytes() == expected[key].tobytes(), key
    assert np.all(np.isfinite(x))


def test_a_batch_matches_simulate_bit_for_bit():
    c = fs.conditions_for("lords", ball_age=5)
    releases = fs.sample_releases(fs.ReleaseSpec(), c, 20_000, 99)
    owned = fs.simulate(**releases, conditions=c, seed=7)
    batch = sampled_batch(20_000, 99, c)
    for key in RELEASES:
        assert getattr(batch, key).tobytes() == releases[key].tobytes(), key
    views = batch.simulate(c, seed=7, threads=4)
    for key in OUTCOMES:
        assert views[key].dtype == owned[key].dtype and views[key].tobytes() == owned[key].tobytes(), key


def test_releases_written_into_a_batch_are_checked_at_the_boundary():
    batch = sampled_batch(100)
    batch.z[50] = 0.0
    with pytest.raises(ValueError, match="above the pitch"):
        batch.simulate(fs.Conditions(), seed=1)
    batch.z[50] = 2.0
    batch.simulate(fs.Conditions(), seed=1)  # a failed check does not leave the Batch marked busy


def large_batch_call(path, n):
    c = fs.Conditions()
    if path == "batch":
        batch = sampled_batch(n)
        return lambda: batch.simulate(c, seed=1, threads=1)
    releases = fs.sample_releases(fs.ReleaseSpec(), c, n, 99)
    return lambda: fs.simulate(**releases, conditions=c, seed=1, threads=1)


@pytest.mark.skipif((os.cpu_count() or 1) < 2, reason="needs a second core for the other thread")
@pytest.mark.parametrize("path", ["batch", "simulate"])
def test_another_python_thread_runs_while_a_batch_simulates(path):
    call = large_batch_call(path, 600_000)
    stamps, stop = [], threading.Event()

    def tick():
        while not stop.is_set():
            stamps.append(time.perf_counter())  # needs the GIL; impossible while the call holds it
            time.sleep(0.001)

    ticker = threading.Thread(target=tick)
    ticker.start()
    try:
        time.sleep(0.05)
        start = time.perf_counter()
        call()
        end = time.perf_counter()
    finally:
        stop.set()
        ticker.join()
    # Only the middle half counts: a tick can slip in as the call is entered or left even when
    # the GIL is held throughout. Held gives zero there; a 16 ms timer on a loaded machine gives several.
    quarter = (end - start) / 4
    inside = sum(start + quarter < t < end - quarter for t in stamps)
    assert inside >= 3, f"{inside} ticks in the middle of a {end - start:.3f} s call"


def test_one_batch_refuses_a_second_call_while_it_simulates():
    batch, c = sampled_batch(400_000), fs.Conditions()
    worker = threading.Thread(target=lambda: batch.simulate(c, seed=1, threads=1))
    worker.start()
    while not batch.busy and worker.is_alive():
        pass
    assert batch.busy, "the call finished before it was seen running"
    with pytest.raises(RuntimeError, match="already simulating"):
        batch.sample(fs.ReleaseSpec(), c, 99)
    worker.join()
    assert not batch.busy
    batch.simulate(c, seed=1)

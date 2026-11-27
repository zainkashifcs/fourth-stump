"""Cost of handing a batch's outcomes to Python: new arrays per call against views of reused storage (ADR-015).

Usage: python -m fourth_stump.bench_ipc [repeats]
Prints a Markdown table of median wall time per call on every core. Both paths run the same
engine on the same releases and seed, so the difference is what delivery to Python costs.
"""
import ctypes
import sys
import time

import numpy as np

from . import Batch, Conditions, ReleaseSpec, sample_releases, simulate

SIZES = (1_000, 10_000, 100_000, 1_000_000)
SEED = 99


def opt_out_of_power_throttling() -> None:
    """On Windows, stop the OS power-throttling (EcoQoS) this process mid-run; a no-op elsewhere.

    Windows 11 throttles a process started from a background shell a few seconds after launch,
    which tripled single-thread timings. The C++ tools do the same (cpp/bench/power_throttling.hpp).
    """
    if sys.platform != "win32":
        return

    class State(ctypes.Structure):  # PROCESS_POWER_THROTTLING_STATE
        _fields_ = [("Version", ctypes.c_ulong), ("ControlMask", ctypes.c_ulong), ("StateMask", ctypes.c_ulong)]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.SetProcessInformation.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong]
    process_power_throttling, execution_speed = 4, 0x1  # ProcessPowerThrottling, ..._EXECUTION_SPEED
    state = State(1, execution_speed, 0)
    if kernel32.SetProcessInformation(kernel32.GetCurrentProcess(), process_power_throttling,
                                      ctypes.byref(state), ctypes.sizeof(state)):
        print("Windows power throttling (EcoQoS): opted out for this process.\n")
    else:
        print(f"Windows power throttling (EcoQoS): opt-out failed (error {ctypes.get_last_error()}); "
              "timings may be throttled.\n")


def interleaved_median_ns(first, second, repeats: int) -> tuple[float, float]:
    """Median ns per call of each, timed back to back with the order swapped every repeat,
    so a change in clock speed or load during the run hits both alike."""
    first(), second()  # warm up: thread pool, page faults on reused storage
    times = ([], [])
    for r in range(repeats):
        for k in ((0, 1) if r % 2 == 0 else (1, 0)):
            start = time.perf_counter_ns()
            (first, second)[k]()
            times[k].append(time.perf_counter_ns() - start)
    return float(np.median(times[0])), float(np.median(times[1]))


def measure(n: int, repeats: int) -> tuple[float, float]:
    c = Conditions()
    releases = sample_releases(ReleaseSpec(), c, n, SEED)
    batch = Batch(n)
    batch.sample(ReleaseSpec(), c, SEED)
    return interleaved_median_ns(lambda: simulate(**releases, conditions=c, seed=1),
                                 lambda: batch.simulate(c, seed=1), repeats)


def main() -> None:
    opt_out_of_power_throttling()
    repeats = int(sys.argv[1]) if len(sys.argv) > 1 else 31
    if repeats < 1:
        raise SystemExit("repeats must be at least 1")
    print(f"Median of {repeats} calls each, every core, the two calls alternating. `simulate`: new NumPy arrays "
          "each call. `Batch.simulate`: read-only views of reused 64-byte-aligned storage.\n")
    print("| deliveries | `simulate` (us/call) | `Batch.simulate` (us/call) | saved per call (us) | saved per delivery (ns) |")
    print("|---:|---:|---:|---:|---:|")
    for n in SIZES:
        copying, views = measure(n, repeats)
        saved = copying - views
        print(f"| {n:,} | {copying / 1e3:,.1f} | {views / 1e3:,.1f} | {saved / 1e3:,.1f} | {saved / n:.2f} |")


if __name__ == "__main__":
    main()

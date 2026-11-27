// Benchmark hygiene, shared by the benchmark tools. Windows 11 power-throttles (EcoQoS) a
// process started from a background shell a few seconds after launch: one single-thread batch
// went from 517 to 1,696 ns per delivery, then back to 517 once the process opted out. The tools
// opt out first and print one line saying whether it worked. Elsewhere this does nothing.
#pragma once

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cstdio>
#endif

namespace fs::bench {

inline void opt_out_of_power_throttling() noexcept {
#ifdef _WIN32
    PROCESS_POWER_THROTTLING_STATE state{};
    state.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
    state.ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
    state.StateMask = 0;  // execution-speed throttling off
    if (SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling, &state, sizeof(state)))
        std::printf("Windows power throttling (EcoQoS): opted out for this process.\n\n");
    else
        std::printf("Windows power throttling (EcoQoS): opt-out failed (error %lu); timings may be throttled.\n\n",
                    GetLastError());
#endif
}

}  // namespace fs::bench

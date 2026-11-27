# Plain Makefile with g++ and uv, no CMake

CMake is the expected build system for a C++ project, but the development machine has only MSYS2 g++ 16.2 and `mingw32-make`, and the engine is header-only with a handful of targets. We build with one `Makefile` (`g++ -std=c++20 -O3 -march=native -fopenmp -Wall -Wextra -Wpedantic`) and manage Python with `uv`, so a reader can see every compiler flag behind every benchmark number in one file.

## Considered options

- **CMake + Ninja** (installable through `winget`): rejected for now. It adds a generator layer and an install step for a project with no dependencies to discover. Revisit if the engine gains third-party C++ dependencies or needs an MSVC build.

## Consequences

- The Makefile must run under both `mingw32-make` (local, Windows) and `make` (Linux CI), so recipes stay POSIX-shell only.
- The Python binding is compiled by MinGW g++ against a uv-managed CPython, not the Microsoft Store Python, whose install path cannot be used for include directories. A smoke test on 2026-11-26 built and imported a pybind11 + OpenMP module this way with no warnings.
- On Windows the binding is linked with `-static`, so the MinGW OpenMP, C++ and threading runtimes are inside the module and `import` works in any terminal with no MSYS2 on `PATH`. Tested on 2026-11-26: the module's only non-system dependency is `python313.dll`. Calling `os.add_dll_directory` from `__init__.py` was rejected as the primary fix because it hardcodes one machine's MSYS2 path.
- `-march=native` means benchmark figures are specific to the machine that produced them, and the README must name that machine.

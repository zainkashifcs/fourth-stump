# Fourth Stump EV. One build entry point (ADR-002).
# Windows: run `mingw32-make` from a POSIX shell (Git Bash or MSYS2). Linux: `make`.
# Every compiler flag behind every benchmark number is in this file.

CXX      ?= g++
# -ffast-math is banned (ADR-003). -ffp-contract=off stops the compiler fusing multiply-adds
# differently in different callers, so a delivery gives the same bits wherever it is evaluated.
CXXFLAGS := -std=c++20 -O3 -march=native -ffp-contract=off -fopenmp -Wall -Wextra -Wpedantic -Icpp/include
WERROR   := -Werror
BUILD    := build
PY       := uv run python

ifeq ($(OS),Windows_NT)
  EXE     := .exe
  # Static runtimes: binaries and the Python module run with no MSYS2 on PATH (ADR-002).
  LDFLAGS := -static
else
  EXE     :=
  LDFLAGS :=
endif

HEADERS := $(wildcard cpp/include/*.hpp)
TESTS   := $(BUILD)/tests$(EXE)
BENCH   := $(BUILD)/bench$(EXE)
ERRTOOL := $(BUILD)/error_bound$(EXE)

.PHONY: all test cpp-test bench error-bound python pytest bench-ipc viz-data clean

all: $(TESTS) $(BENCH) $(ERRTOOL)

# Every gate: C++ tests, then the Python tests against the freshly built binding.
test: cpp-test pytest

cpp-test: $(TESTS)
	./$(TESTS)

bench: $(BENCH)
	./$(BENCH) | tee $(BUILD)/bench.md

error-bound: $(ERRTOOL)
	./$(ERRTOOL) | tee $(BUILD)/error_bound.md

$(BUILD):
	mkdir -p $(BUILD)

# Catch2 is third-party code: built once, without -Werror.
$(BUILD)/catch.o: cpp/third_party/catch_amalgamated.cpp | $(BUILD)
	$(CXX) -std=c++20 -O1 -Icpp/third_party -c $< -o $@

$(BUILD)/test_%.o: cpp/tests/test_%.cpp $(HEADERS) | $(BUILD)
	$(CXX) $(CXXFLAGS) $(WERROR) -Icpp/third_party -c $< -o $@

$(TESTS): $(BUILD)/test_engine.o $(BUILD)/test_alloc.o $(BUILD)/catch.o
	$(CXX) $(CXXFLAGS) $^ -o $@ $(LDFLAGS)

$(BENCH): cpp/bench/bench.cpp $(HEADERS) cpp/bench/power_throttling.hpp | $(BUILD)
	$(CXX) $(CXXFLAGS) $(WERROR) $< -o $@ $(LDFLAGS)

$(ERRTOOL): cpp/bench/error_bound.cpp $(HEADERS) | $(BUILD)
	$(CXX) $(CXXFLAGS) $(WERROR) $< -o $@ $(LDFLAGS)

# Tail latency per simulate_batch call, and the measured cost of false sharing.
LATENCY := $(BUILD)/latency$(EXE)
.PHONY: latency
all: $(LATENCY)

latency: $(LATENCY)
	./$(LATENCY) | tee $(BUILD)/latency.md

$(LATENCY): cpp/bench/latency.cpp $(HEADERS) cpp/bench/power_throttling.hpp | $(BUILD)
	$(CXX) $(CXXFLAGS) $(WERROR) $< -o $@ $(LDFLAGS)

# Python binding, compiled against the uv-managed interpreter.
python:
	$(PY) cpp/python/build_binding.py $(CXX) $(CXXFLAGS) $(WERROR)

pytest: python
	uv run pytest -q

# Delivering outcomes to Python: new arrays per call against views of reused storage (ADR-015).
bench-ipc: python | $(BUILD)
	$(PY) -m fourth_stump.bench_ipc | tee $(BUILD)/bench_ipc.md

viz-data: python
	$(PY) -m fourth_stump.export_viz

clean:
	rm -rf $(BUILD) fourth_stump/_engine*

# The page's live engine (ADR-016). Single-threaded, no OpenMP, no fast-math, fixed memory.
# The outputs are committed so the page needs no build step. Needs emcc on PATH (emsdk_env).
EMCC      ?= emcc
WASMFLAGS := -std=c++20 -O3 -ffp-contract=off -Wall -Wextra -Wpedantic -Werror -Icpp/include \
             -fno-exceptions -fno-rtti -fno-threadsafe-statics -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
             -sFILESYSTEM=0 -sMALLOC=none -sINITIAL_HEAP=65536 -sDYNAMIC_EXECUTION=0 -sINCOMING_MODULE_JS_API=[] \
             -sEXPORTED_RUNTIME_METHODS=HEAPF64 \
             -sEXPORTED_FUNCTIONS=_live_inputs,_live_counts,_live_outputs,_live_arrivals,_live_path,_live_capacity,_live_check,_live_limit,_live_length,_live_release_y,_live_simulate,_live_summarize,_live_sample
.PHONY: wasm
wasm: viz/wasm/engine.mjs

viz/wasm/engine.mjs: cpp/wasm/live.cpp $(HEADERS)
	mkdir -p viz/wasm
	$(EMCC) $(WASMFLAGS) $< -o $@

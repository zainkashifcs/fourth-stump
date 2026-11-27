// simulate_batch must not allocate (ADR-012). This file replaces global operator new
// for the whole test binary and counts calls made while the counter is armed.
// It cannot see malloc calls made inside the OpenMP runtime, so the runtime is warmed
// up before the counter is armed.
#include <atomic>
#include <cstdlib>
#include <new>

#include "catch_amalgamated.hpp"
#include "fourth_stump_engine.hpp"

namespace {
std::atomic<bool> g_armed{false};
std::atomic<long> g_allocations{0};

void* counted_alloc(std::size_t size, std::size_t align) {
    if (g_armed.load(std::memory_order_relaxed)) g_allocations.fetch_add(1, std::memory_order_relaxed);
    if (size == 0) size = 1;
#ifdef _WIN32
    void* p = _aligned_malloc(size, align);
#else
    void* p = std::aligned_alloc(align, (size + align - 1) / align * align);
#endif
    if (!p) throw std::bad_alloc();
    return p;
}
void counted_free(void* p) noexcept {
#ifdef _WIN32
    _aligned_free(p);
#else
    std::free(p);
#endif
}
}  // namespace

void* operator new(std::size_t n) { return counted_alloc(n, alignof(std::max_align_t)); }
void* operator new[](std::size_t n) { return counted_alloc(n, alignof(std::max_align_t)); }
void* operator new(std::size_t n, std::align_val_t a) { return counted_alloc(n, static_cast<std::size_t>(a)); }
void* operator new[](std::size_t n, std::align_val_t a) { return counted_alloc(n, static_cast<std::size_t>(a)); }
void operator delete(void* p) noexcept { counted_free(p); }
void operator delete[](void* p) noexcept { counted_free(p); }
void operator delete(void* p, std::size_t) noexcept { counted_free(p); }
void operator delete[](void* p, std::size_t) noexcept { counted_free(p); }
void operator delete(void* p, std::align_val_t) noexcept { counted_free(p); }
void operator delete[](void* p, std::align_val_t) noexcept { counted_free(p); }
void operator delete(void* p, std::size_t, std::align_val_t) noexcept { counted_free(p); }
void operator delete[](void* p, std::size_t, std::align_val_t) noexcept { counted_free(p); }

TEMPLATE_TEST_CASE("simulate_batch makes no heap allocation", "", fs::XoshiroZiggurat, fs::PhiloxBoxMuller) {
    using namespace fs;
    const Conditions c;
    BatchStorage batch(100'000);
    batch.sample(ReleaseSpec{}, c, 7);
    OutcomeBatch out = batch.outcomes();
    simulate_batch<TestType>(batch.releases(), c, 1, out);  // warm up tables and the thread pool

    g_allocations = 0;
    g_armed = true;
    simulate_batch<TestType>(batch.releases(), c, 2, out);
    const Summary s = summarize(batch.leave.span(), batch.play.span());
    g_armed = false;

    CHECK(g_allocations.load() == 0);
    CHECK(s.n == 100'000);
}

TEST_CASE("the allocation counter does see allocations") {
    g_allocations = 0;
    g_armed = true;
    delete new int(1);
    g_armed = false;
    CHECK(g_allocations.load() == 1);
}

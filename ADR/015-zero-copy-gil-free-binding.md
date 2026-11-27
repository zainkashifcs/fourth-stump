# Engine storage reaches Python as views, and engine calls run without the GIL

The binding gains a `Batch` class that owns one `BatchStorage`: the engine's 64-byte-aligned structure-of-arrays buffers for releases and outcomes. `Batch.sample` fills the releases, `Batch.simulate` runs `simulate_batch` into the outcomes and returns them as NumPy views of that storage, never copies, and the same storage is reused on every call. Every engine call in the binding (`simulate_batch`, `sample_releases`, the reference trajectory) runs with the GIL released, after all validation and before any Python object is built. `simulate` keeps its signature and its owned, writeable arrays, so no caller changes.

Before this change `simulate` already wrote straight into NumPy arrays it allocated on each call; nothing was copied twice. What a caller paid per call was allocating nine fresh arrays and the page faults of writing them for the first time. A reused `Batch` pays neither, and its buffers have the alignment the engine was designed around instead of NumPy's default. `make bench-ipc` measures the difference on the same releases and seed.

## Considered options

- **Make `simulate` return views of a fresh `BatchStorage`, kept alive by a capsule**: rejected. It would still allocate on every call, so it saves nothing over writing into new NumPy arrays, and its arrays would become read-only under existing callers.
- **Copy the engine's storage into new NumPy arrays**: rejected. It adds a pass over every output to what `simulate` already does.
- **Writeable outcome views**: rejected. Every view of an outcome aliases storage that the next `simulate` on the same `Batch` overwrites, and a write through one view silently changes what every other holder reads. Read-only turns that write into an error. Release views stay writeable: that is how a caller loads its own releases without another copy.

## Consequences

- Lifetime rule: every view's base is the `Batch` object itself, so the storage is freed only when the `Batch` and every view of it are gone. Dropping the `Batch` while holding views is safe.
- Aliasing rule: a view shows the storage, not a snapshot. The next `Batch.simulate` or `Batch.sample` rewrites what earlier views show. A caller that needs to keep a result across calls copies it (`view.copy()`).
- `Batch.simulate` validates the releases in its storage at the boundary on every call, since the writeable release views may have changed them since the last call.
- A `Batch` refuses a second `sample` or `simulate` while one runs on another thread (`RuntimeError`); the flag is read and written only with the GIL held. Writing release views from another thread while it simulates is not guarded, and neither is mutating the arrays passed to `simulate` during the call.
- The thread count still applies per call: each call sets OpenMP's count on the calling thread, so concurrent callers on different Python threads do not change each other's.
- `Batch` is re-exported from `fourth_stump` beside the other engine names.

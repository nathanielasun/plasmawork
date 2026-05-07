# cuda — GPU backend adapter

This adapter ships:

- `detect_capability()` — non-raising probe that returns a structured
  `GPUCapability` describing whether a CUDA runtime + visible device
  exist on this machine.
- `estimate_memory(grid_points, fields, dtype_bytes)` — closed-form
  memory estimator (state + workspace) callers use to decide whether
  a problem fits before they submit.
- `CUDABackend` adapter exposing `is_available()`, `memory_estimate()`,
  and `determinism_warning()`.
- `ADR-0006-determinism-policy.md` documenting the GPU determinism
  policy (bitwise reproducibility is not promised on GPU; results
  match within representable rounding).

Validated kernel implementations are still downstream work for each physics
module that needs GPU execution. This adapter does NOT auto-fall-back to CPU —
silent fallback would hide a missing GPU; callers inspect `is_available()` and
choose a different backend.

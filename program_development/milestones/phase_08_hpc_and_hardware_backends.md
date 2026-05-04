# Phase 8 — HPC and Hardware Backends

**Status: Complete (2026-05-04).** All six workstreams 8A–8F shipped. Default convention checker green at 609 checks; opt-in mode reports no open workstreams.

## Objective
Scale from local interactive experiments to high-performance parameter sweeps and large simulations. (Plan §Phase 8.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 8A | Backend Abstraction | interface, registry, capability detection, recommendation |
| 8B | Python/CPU Backends | NumPy, SciPy wrappers, Numba acceleration, multiprocessing for small sweeps |
| 8C | Compiled Kernels | C++, Fortran, build integration, ABI/interface wrappers |
| 8D | GPU Backends | CUDA, HIP/SYCL/Kokkos exploration, precision settings, determinism warnings, memory estimator |
| 8E | HPC Orchestration | Slurm, Ray, batch jobs, remote tracking, result import |
| 8F | External Simulator Integration | PIC codes, plasma tools, PDE solvers, visualization exporters |

## Phase Gate
Phase 8 is complete when experiments can run locally and on remote/HPC backends through the same experiment interface.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

Starting-point hints from plan §Phase 8:

- ☑ Stable backend interface in `packages/core/src/simworkbench/runtime/solver_backend.py` (`SolverBackend` ABC + `BackendCapabilities` descriptor).
- ☑ Backend registry (`simworkbench.backends.BackendRegistry`) consumes `configs/backends.yaml`, refuses invalid entries (rule 20), exposes capability-aware `recommend()`. Lifecycle gate lives at the `set_status` mutation boundary (rule 18).
- ☑ `packages/solver_backends/python_cpu/` is a real implementation; `validated`.
- ☑ `packages/solver_backends/numba_cpu/` real Numba-JIT backend with NumPy fallback; cross-backend agreement vs python_cpu within 1e-6 relative; `validated`.
- ☑ `packages/solver_backends/cpp/` CMake build pipeline with `axpy` reference kernel + ctypes ABI wrapper.
- ☑ `packages/solver_backends/cuda/` GPU adapter with capability detection + memory estimator + determinism warning.
- ☑ `packages/solver_backends/external_pic/` adapter contract + reference `StubPICAdapter`; concrete wrappers (WarpX/Smilei/EPOCH) land per-need.
- ☑ HPC orchestration scripts under `scripts/dev/` (`submit_slurm.sh`, `import_hpc_result.sh`); `simworkbench.hpc` ships `SlurmJob`, `RayAdapter`, `import_remote_result`.
- ☑ `ADR-0006-determinism-policy.md` — Accepted.
- ☑ Cross-backend validation: `python_cpu` and `numba_cpu` agree within 1e-6 relative on the canonical 2-species conversion experiment.
- ☑ `configs/backends.yaml` — `python_cpu` and `numba_cpu` validated; `cpp` in_progress; the rest planned.
- ☑ `provenance.lock` carries the determinism marker, read from the live backend's `CAPABILITIES.deterministic` at save time per ADR-0006.

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 8 row, `timeline.md`, `configs/backends.yaml`, the new determinism ADR, and any docs page that named "Phase 8 — pending".

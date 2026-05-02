# Phase 8 — HPC and Hardware Backends

**Status: Not started**

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

- ☐ Stable backend interface in `packages/core/src/simworkbench/runtime/solver_backend.py` matching plan §15.1.
- ☐ Backend registry that consumes `configs/backends.yaml` and exposes capability detection.
- ☐ `packages/solver_backends/python_cpu/` is a real implementation (no longer planned).
- ☐ `packages/solver_backends/numba_cpu/` Numba-accelerated kernels with benchmark vs. python_cpu.
- ☐ `packages/solver_backends/cpp/` build pipeline (CMake-based) with kernel ABI wrappers.
- ☐ `packages/solver_backends/cuda/` GPU adapter with explicit determinism warning.
- ☐ `packages/solver_backends/external_pic/` adapter wrapping at least one external PIC code.
- ☐ HPC orchestration scripts under `scripts/dev/` for Slurm and Ray submission, plus result import.
- ☐ ADR on determinism policy (GPU bitwise-determinism limits, fp32 vs. fp64 defaults).
- ☐ Cross-backend validation: the same ModelSpec produces results within tolerance across at least two backends for a given regime.
- ☐ `configs/backends.yaml` — backend status fields transition `planned → in_progress → validated`.
- ☐ Reality-test the determinism markers in `provenance.lock` per plan §11.3.

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 8 row, `timeline.md`, `configs/backends.yaml`, the new determinism ADR, and any docs page that named "Phase 8 — pending".

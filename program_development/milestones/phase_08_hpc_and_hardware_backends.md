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

# python_cpu — Phase 8 validated CPU backend

Wraps `scipy.integrate.solve_ivp` (LSODA) for 0D rate-equation models.
The Phase-1 implementation lives at
`packages/core/src/simworkbench/runtime/python_cpu.py`; this package
exposes it as a Phase-8 ``SolverBackend`` and registers it with the
runtime on import.

## Capability

- Domains: species, laser_species, rate_equations, phase_transition
- Geometries: 0D
- Precision: float64
- Deterministic: yes (identical inputs → identical outputs)

## Validation

Phase 7 closed `python_cpu` against analytic benchmarks:
- First-order decay (Phase 7 / 7B `species/rate_equation_0d`)
- Two-species mass conservation
- Lambert-Beer absorption (laser/absorption_lambert_beer)

Phase 8 promotes the registry status from `planned` → `validated`.

# Lennard-Jones molecular dynamics

End-to-end exercise of the **validated** Lennard-Jones MD module
(`packages/physics_modules/molecular_dynamics/lennard_jones/`)
running a small 2D system at ~100 K.

## What this is

A textbook NVE Lennard-Jones run:
- 64 argon-mass particles in a 3.4 nm × 3.4 nm box.
- LJ parameters tuned to argon: ε = 1.66 × 10⁻²¹ J, σ = 0.34 nm.
- Velocity-Verlet integrator at 4 fs timestep for 200 steps (~0.8 ps).
- Initial velocities drawn from a Maxwell-Boltzmann distribution at
  the requested temperature.

## Why "validated"

The module is at lifecycle status `validated` (Phase 7) against an
energy-drift criterion: relative drift of total energy stays below
1e-3 over 1000 steps for the tested parameter set. The example
reports the realized drift so you can confirm the bound holds for
your run.

## Running

```bash
python examples/molecular_dynamics/run.py
# longer simulation + warmer system:
python examples/molecular_dynamics/run.py --n-steps 1000 --temperature-K 200
# more particles:
python examples/molecular_dynamics/run.py --n-particles 256
```

The run writes a JSON summary to `temp_runs/<run_id>/summary.json`
with the realized energy drift, reduced temperature T*, and the
total-energy trace's first/last samples.

## Reading the output

Expected with defaults (64 particles, 200 steps, 100 K):
- `energy_drift = ~ 1e-4` (well within the validated bound).
- `T* ≈ 0.83` (reduced units; 100 K → kT/ε for argon).

A drift > 1e-3 with default parameters indicates either a bug in the
integrator or an unexpected platform/numerics issue — file an entry
in `bugs_and_fixes/bugfixes.md`.

## Going beyond Lennard-Jones

This module is a single-component LJ-only solver. Multi-component
mixtures, electrostatic interactions, periodic-boundary corrections
beyond the minimum-image convention, and constant-temperature
ensembles (NVT / NPT) are not implemented — see
[`LIMITATIONS.md`](../../LIMITATIONS.md). The molecular_dynamics
domain in the registry has slots for them.

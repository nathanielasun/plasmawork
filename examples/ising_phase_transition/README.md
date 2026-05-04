# 2D Ising — phase-transition sweep

End-to-end exercise of the **validated** 2D Ising module
(`packages/physics_modules/phase_transition/ising_2d/`) sweeping
reduced temperature across the Onsager critical point T*c ≈ 2.269.

## What this is

A small Metropolis Monte Carlo simulation on a periodic 12 × 12
square lattice:
- Sweep over reduced temperatures: 1.5, 2.0, 2.27, 2.5, 3.0, 4.0
  (straddling Onsager's exact value 2.269).
- 200 equilibration sweeps + 400 measurement sweeps per temperature.
- Reports magnetization per spin |m|, energy per spin e, heat
  capacity per spin C, and susceptibility per spin χ.

## Why "validated"

The module is at lifecycle status `validated` (Phase 7) against
Onsager's exact result: the critical temperature T*c = 2.269 is
recovered within 5% on a 16 × 16 lattice (the module's
own test exercises this). At small lattice sizes the transition is
broadened by finite-size effects; the example uses 12 × 12 by
default to keep the run cheap.

## Running

```bash
python examples/ising_phase_transition/run.py
# bigger lattice + longer runs (sharper transition):
python examples/ising_phase_transition/run.py --lattice-size 24 --n-sweeps 800

# different seed:
python examples/ising_phase_transition/run.py --seed 7
```

The run writes a JSON summary to `temp_runs/<run_id>/summary.json`
with the per-temperature row of (T*, |m|, e, χ, C/spin) plus the
Onsager reference T*c.

## Reading the output

Expected with the defaults (12 × 12, 400 sweeps after equilibration):
- |m| close to 1.0 at T* = 1.5 (ordered phase).
- |m| close to 0 at T* = 4.0 (disordered phase).
- The transition region (T* ≈ 2.0–3.0) shows |m| dropping rapidly,
  with χ peaking near T*c.
- The exact 12 × 12 transition is broadened; for sharper features
  bump `--lattice-size` to 24 or higher.

## Going beyond 2D nearest-neighbour Ising

This module is square-lattice nearest-neighbour Ising only. 3D
lattices, anisotropic interactions, external fields, and frustrated
systems are not implemented — see
[`LIMITATIONS.md`](../../LIMITATIONS.md). The phase_transition slot
in the registry has room for them.

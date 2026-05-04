# 1D wave equation — Gaussian pulse

End-to-end exercise of the **validated** 1D wave-equation module
(`packages/physics_modules/pde/wave_equation_1d/`) using a Gaussian
initial displacement on a string fixed at both ends.

## What this is

- A leapfrog explicit scheme on a uniform grid with Dirichlet BCs.
- Initial condition: `u(x, 0) = exp(-((x - L/2) / (L/20))²)` (a
  centered Gaussian one-twentieth of the domain wide).
- Initial velocity is zero. By D'Alembert's solution, the pulse
  splits immediately into two counter-propagating half-amplitude
  copies; `u_max` therefore drops from 1.0 to ≈ 0.5 within the first
  few timesteps. **This is real physics, not a numerical artifact.**
- A grid-convergence step doubles the resolution (and halves dt to
  preserve CFL) and reports the L2 difference between the two
  trajectories at `t_final`. The module advertises 2nd-order
  convergence; halving dx should drop the error by ~4×.

## Why "validated"

`wave_equation_1d` is at lifecycle status `validated` (Phase 7B). The
module's tests assert 2nd-order convergence and CFL-violation
refusal. This example stays inside the module's documented validity
domain (CFL ≤ 1, Dirichlet BCs, smooth-enough initial data) and the
run produces deterministic, reproducible output.

## Running

```bash
python examples/pde_wave_equation/run.py
# higher resolution + tighter CFL:
python examples/pde_wave_equation/run.py --grid-nx 401 --cfl 0.5

# skip the convergence comparison (saves the half-grid run):
python examples/pde_wave_equation/run.py --no-convergence-check
```

The run writes:
- `temp_runs/<run_id>/summary.json` — configuration, realized CFL,
  initial/final amplitudes, convergence block (when not skipped).
- `temp_runs/<run_id>/final_snapshot.csv` — `(x_meters, u_t_final)`
  for the coarse-grid solution; load this into the Plot panel or any
  CSV-aware tool to inspect the wavefront.

## Reading the output

Expected with the defaults (L = 1 m, c = 1 m/s, nx = 201, CFL = 0.8):
- `u_max(t=0) = 1.0000`, `u_max(t_final) ≈ 0.5000` (D'Alembert split).
- Realized CFL = 0.8000.
- L2 error vs. fine grid ≈ a few × 10⁻³; halving dx should drop this
  by roughly a factor of 4 (the module's claimed 2nd-order rate).

## Going beyond linear waves

This module solves the linear wave equation only. For nonlinear
waves, multi-D problems, or absorbing boundaries, look at
`packages/physics_modules/pde/reaction_diffusion_1d/` (also
`validated`) or wait for additional PDE solvers per
[`LIMITATIONS.md`](../../LIMITATIONS.md). The module slots are in
the registry; the science is the work.

# Laser-species absorption sweep

End-to-end exercise of the **validated** Lambert-Beer absorption module
(`packages/physics_modules/laser/absorption_lambert_beer/`). Every
result here is closed-form against the analytic law I(z) = I₀ ·
exp(-α z), so the example doubles as a smoke check that the module's
unit handling and arithmetic still work after a refactor.

## What this is

Two sweeps:

1. **Path-length sweep** at fixed absorption coefficient α. Reproduces
   the exponential attenuation curve. The 1/e path length is computed
   inversely via `LambertBeerAbsorber.path_length_for_transmission`
   and matches the analytic value `1/α` exactly.
2. **Coefficient sweep** at fixed path length z = 1/α₀ (one nominal
   1/e length). Shows transmission falling from ~0.9 at α/10 to ~0.007
   at 5α₀.

Both sweeps are written to CSV alongside the JSON summary so a
downstream Plot panel or comparison report can render the results
without re-running the simulation.

## Why "validated"

The `absorption_lambert_beer` module is at lifecycle status
`validated` against an analytic limit (Phase 7B). The module's tests
in `packages/physics_modules/laser/absorption_lambert_beer/tests/`
assert exact agreement with `I(z) = I₀ · exp(-α z)` to machine
precision. This example stays inside that domain — no saturation, no
dispersion, no spectral structure — so the results are exact.

## Running

```bash
python examples/laser_species/run.py
# or with custom optical parameters:
python examples/laser_species/run.py --i0-W-per-m2 1e10 --alpha-1-per-m 0.5
```

The run writes:
- `temp_runs/<run_id>/summary.json` — full configuration + both sweeps.
- `temp_runs/<run_id>/path_sweep.csv` — `z_meters, transmission, I_W_per_m2`.
- `temp_runs/<run_id>/coefficient_sweep.csv` — `alpha_1_per_m, transmission, I_W_per_m2`.

## Reading the output

Expected with the defaults (I₀ = 1e10 W/m², α = 2.5/m):
- The path sweep starts at T = 1.000 (z = 0) and decays toward 0.
- The 1/e path length should be 1/α = 0.400 m (the runner prints
  this and the closed-form expected value side-by-side).
- The coefficient sweep at z = 0.400 m should pass through T = 1/e ≈
  0.368 when α = α₀ = 2.5/m (the row closest to that α).

## Going beyond Lambert-Beer

This module's validity domain is "homogeneous medium, linear
absorption, no saturation, no dispersion". For
saturable absorbers, frequency-dependent attenuation, or coupled
multi-species absorbers, look at
`packages/physics_modules/laser/{excitation,ionization}/` (currently
`candidate` status) or wait for paper ingestion to supply the model
extensions per [`LIMITATIONS.md`](../../LIMITATIONS.md).

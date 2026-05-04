# Simple rate equations — Phase 1 canonical example

The first end-to-end ModelSpec → Runner → Capsule example the
workbench shipped, and the reference fixture for most Phase-1
unit/integration tests. Two species, one laser-driven photoexcitation
interaction, real `python_cpu` rate-equation backend.

## What this is

- **2 species:** A (initial 1.0e18 1/m³) and B (initial 0).
- **1 field:** a 248 nm laser pulse, `1.0e10 W/m²` peak intensity,
  `25 ns` duration.
- **1 interaction:** `A_to_B_photoexcitation` (A → B driven by the
  laser field).
- **End-to-end pipeline:** loads `model.yaml`, builds an `Experiment`,
  runs through `simworkbench.runtime.Runner`, writes a JSON summary
  under `temp_runs/<run_id>/`, and saves a portable capsule under
  `simulation_capsules/`.

## Why "exploratory"

The interaction's rate constant is a `placeholder:` entry in
`coefficient_sources` — Phase 1 has no rate-constant parser, so
running with placeholder rates is the only honest path. Per Plan §22
(Scientific Accuracy Policy), a capsule produced from this run lands
with status `exploratory`, not `validated`. Real coefficients land
through Phase-4 paper ingestion.

## Running

```bash
# Default: 100 max steps, 100 ns end time, capsule saved.
python examples/simple_rate_equations/run.py

# Custom parameters:
python examples/simple_rate_equations/run.py \
    --max-steps 200 --end-time "200 ns" --seed 7

# Skip the capsule save (just produce the temp_runs/ summary):
python examples/simple_rate_equations/run.py --no-capsule
```

The run writes:
- `temp_runs/<run_id>/summary.json` — final time, A and B
  trajectories, placeholder list.
- `simulation_capsules/simple_rate_equations-<hash>.lxp/` — full
  capsule with manifest, model spec, results (HDF5), provenance triad,
  diagnostics. Reload with `scripts/dev/run_capsule.sh <name>`.

## Reading the output

Expected with the defaults:
- `A(0) = 1.000e+18`, `A(t_final)` close to 0.
- `B(0) = 0.000e+00`, `B(t_final)` close to 1.000e+18.
- `A + B` is conserved to within solver tolerance (the validation
  block in the YAML pins this as an invariant).
- The terminal prints an `[exploratory]` banner because the rate is
  a placeholder.

## Tests that consume this fixture

- `tests/unit/test_modelspec.py` — schema parse + roundtrip.
- `tests/integration/test_runtime_python_cpu.py` — backend smoke run.
- `tests/integration/test_runner_lifecycle.py` — start/pause/resume/stop.
- `tests/integration/test_capsule_save_reload.py` — capsule round-trip.
- `tests/regression/test_runtime_writes_only_to_temp_runs.py` — locality.

If you're modifying any of these subsystems, run this example by
hand before claiming the change is complete.

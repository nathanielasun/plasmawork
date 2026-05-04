# Parameter Sweep — Quadratic

Phase 9 reference example. Runs a Latin-hypercube sweep over
`f(x, y) = (x - 1)^2 + (y - 2)^2`, ranks the runs by loss, and writes
a comparison report.

## Run

```bash
python examples/parameter_sweep_quadratic/run_sweep.py
```

Output lands under `temp_runs/parameter_sweep_quadratic_demo/`:

- `sweep_checkpoint.json` — sweep checkpoint (resumable).
- `comparison/manifest.json` — machine-readable ranking.
- `comparison/report.md` — Markdown summary with best-run callout.

## What the example demonstrates

- `LatinHypercubeSampler` for stratified sampling of the parameter
  space.
- `SweepEngine.run()` aggregates per-run metrics into a `SweepReport`.
- Sweep-level checkpointing: kill the run partway and re-launch with
  `SweepEngine.resume()` (see `tests/integration/test_phase_9_gate_walk.py`).
- `ComparisonReport.write()` produces a portable Markdown + JSON
  summary the UI's **Comparisons** tab consumes through
  `GET /api/comparison/{capsule}`.

## Expected output

The minimum is at `(x, y) = (1, 2)` with `loss = 0`. With 32 LHS
samples in the box `(-3..3) × (-1..5)`, the best run typically lands
within ~1.0 of the true minimum.

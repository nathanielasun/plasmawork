# Phase 9 — Parameter Sweeps, Optimization, and Uncertainty

**Status: Complete (2026-05-04).** All four workstreams 9A–9D shipped. Default convention checker green at 646 checks; opt-in mode reports no open workstreams.

## Objective
Turn the workbench into a computational experiment factory. (Plan §Phase 9.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 9A | Parameter Sweep Engine | grid, random, Latin hypercube, adaptive sweeps, checkpointing, aggregation |
| 9B | Optimization Engine | Bayesian hooks, multi-objective optimization, constraints, budget limits, early stopping |
| 9C | Uncertainty Quantification | parameter/numerical uncertainty, sensitivity, intervals, dominant uncertainty attribution |
| 9D | Comparative Experiment Reports | model/solver/backend comparisons, validation metrics, ranked summaries |

## Phase Gate
Phase 9 is complete when the system can run parameter sweeps, rank outputs, quantify uncertainty, and generate comparison reports.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

Starting-point hints from plan §Phase 9:

- ☑ `simworkbench.sweep` — `SweepEngine` + `GridSampler`, `RandomSampler`, `LatinHypercubeSampler`, `AdaptiveSampler` ABC; `SweepSpec.max_evaluations` is the hard cap (no bypass kwargs); `SweepCheckpoint` JSON survives kill-and-resume.
- ☑ `simworkbench.optimization` — `Optimizer` ABC, `RandomSearchOptimizer`, `BayesianOptimizerHook` (skopt optional dep with structured `BayesianUnavailable` error), `OptimizationProblem.budget` hard cap, `early_stop_threshold`, multi-objective scalarization, constraint handling.
- ☑ `simworkbench.uncertainty` — `MonteCarloPropagator`, `SensitivityAnalysis`, `ParameterDistribution` (normal/uniform/lognormal), `bootstrap_confidence_interval`, `dominant_uncertainty`.
- ☑ `simworkbench.reports.ComparisonReport` — ranks `SweepReport` runs by metric, writes `manifest.json` + `report.md`. Backend endpoint `GET /api/comparison/{capsule}` surfaces the manifest.
- ☑ Comparison dashboard accessible from `apps/workbench-ui/` — new "Comparisons" tab + `ComparisonReportPanel.tsx` + Vitest tests.
- ☑ Example: `examples/parameter_sweep_quadratic/` runs an LHS sweep + writes a comparison report end-to-end.
- ☑ Budget enforcement: gate-walk + `test_optimization_budget.py` exercise sweep + optimizer caps; signature-introspection regression refuses any future bypass kwargs.
- ☑ `tests/integration/test_sweep_engine.py`, `tests/integration/test_optimization_budget.py`, `tests/validation/test_uq_calibration.py` plus the gate walk.
- ☑ Sweep child rows carry `parent_sweep_id` so downstream provenance can rebuild the chain.

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 9 row, `timeline.md`, and any docs page that named "Phase 9 — pending".

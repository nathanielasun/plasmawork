# Phase 9 — Parameter Sweeps, Optimization, and Uncertainty

**Status: Not started**

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

- ☐ `packages/core/src/simworkbench/sweep/__init__.py` — sweep engine supporting grid, random, Latin hypercube, and adaptive sampling. Sweep-level checkpointing.
- ☐ `packages/core/src/simworkbench/optimization/__init__.py` — Bayesian / multi-objective hooks with explicit budget caps.
- ☐ `packages/core/src/simworkbench/uncertainty/__init__.py` — parameter and numerical uncertainty propagation, sensitivity analysis, confidence intervals, dominant-uncertainty attribution.
- ☐ Comparative reports: ranked summaries across model variants, solver variants, backends, validation metrics. Output as a portable report under the capsule.
- ☐ Comparison dashboard accessible from `apps/workbench-ui/`.
- ☐ At least one sweep capsule example runs end-to-end and produces a ranked output table plus uncertainty bars.
- ☐ Budget enforcement: a sweep with a budget cap stops at the cap with no silent overrun.
- ☐ `tests/integration/test_sweep_engine.py`, `tests/integration/test_optimization_budget.py`, `tests/validation/test_uq_calibration.py`.
- ☐ Sweep / optimization runs feed `provenance.lock` (every child run is part of the sweep's provenance chain).

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 9 row, `timeline.md`, and any docs page that named "Phase 9 — pending".

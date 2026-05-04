# Phase 10 — Autonomous Computational Experiment Design

**Status: Complete (2026-05-04)**

## Objective
Allow agents to propose, execute, analyze, and refine computational experiments under strict validation and budget constraints. (Plan §Phase 10.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 10A | Experiment Design Agent | plans, minimal viable model, fidelity ladder, cost estimate, diagnostics, validation path |
| 10B | Autonomous Small Runs | smoke simulations, diagnostics interpretation, instability detection, safe parameter adjustment, review report |
| 10C | Controlled Sweep Agent | bounded sweeps, monitoring, failure stops, trend summaries, next-sweep recommendations |
| 10D | Scientific Review Agent | critique assumptions, identify missing physics, compare literature, flag overclaims, recommend validation |
| 10E | Human Approval Gates | trusted promotion, expensive runs, external export, destructive edits |

## Phase Gate
Phase 10 is complete when the system can autonomously propose and run bounded computational experiments while preserving inspectability, validation, and human control.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

The Phase 10 surface lives under `packages/core/src/simworkbench/autonomy/`, mirroring the layout used for Phases 4–9. Plan-named deliverables enumerated below; each gets one default convention-checker assertion when complete and one opt-in assertion until then.

**Workstream 10A — Experiment Design Agent**
- ☑ `packages/core/src/simworkbench/autonomy/__init__.py`
- ☑ `packages/core/src/simworkbench/autonomy/experiment_design.py` exposes `ExperimentDesigner`, `ExperimentPlan` dataclass with `minimum_viable_model`, `fidelity_ladder`, `cost_estimate`, `diagnostics`, `validation_path` fields, and `design(spec)` method.
- ☑ Refuses to design from unreviewed paper interpretation (carries Phase 5 hard rule).

**Workstream 10B — Autonomous Small Runs**
- ☑ `packages/core/src/simworkbench/autonomy/smoke_runs.py` exposes `SmokeRunner` with `run(experiment, max_steps)` returning `SmokeReport(diagnostics_interpretation, instability_flags, suggested_param_adjustments, review_markdown)`.
- ☑ Detects obvious numerical instability (NaN, monotonic blow-up, conservation drift) and reports rather than silently retries.

**Workstream 10C — Controlled Sweep Agent**
- ☑ `packages/core/src/simworkbench/autonomy/sweep_agent.py` exposes `ControlledSweepAgent(budget)` whose `launch(spec, objective)` returns a `SweepReport` honoring the budget cap, monitors run-by-run, stops failed runs (already in Phase 9), summarises trends, and emits next-sweep recommendations.
- ☑ Budget cap is the hard ceiling; no `ignore_budget`/`unbounded` kwargs.

**Workstream 10D — Scientific Review Agent**
- ☑ `packages/core/src/simworkbench/autonomy/scientific_review.py` exposes `ScientificReviewer.review(capsule_path)` returning `ScientificReview` with `assumption_critique`, `missing_physics`, `literature_alignment`, `overclaim_flags`, `recommended_validation`.
- ☑ Writes `<capsule>/review/scientific_review.md` and never mutates `<capsule>/src/user_edits/`, `<capsule>/paper_sources/`, or `<capsule>/provenance/`.

**Workstream 10E — Human Approval Gates**
- ☑ `packages/core/src/simworkbench/autonomy/approval_gates.py` exposes `ApprovalGate` with single-use approval tokens for the four documented actions (trusted-module promotion, expensive runs, external export, destructive edits). Mirrors the Phase-7/8 backend-approval pattern.
- ☑ HTTP API never reads `actor`/`role` from the request body (Phase-6 audit pattern); approval comes from out-of-band tokens.
- ☑ Public API exposes no `skip_approval`, `consume_approval=False`, `_for_tests=True`, etc.
- ☑ `configs/agents.yaml` — `orchestrator`, `experiment_design`, `controlled_sweep`, `scientific_review`, `backend_optimization` roles flip to `enabled: true` with explicit budget caps and refusal sets; `human_approval_gates` block already lists the four required gates.

**Cross-cutting**
- ☑ `tests/integration/test_phase_10_gate_walk.py` — gate-walk integration test written FIRST (per ninth Phase-Gate-Procedure check) covering every gate verb.
- ☑ `tests/regression/test_approval_gates_enforcement.py` — every approval gate exercised with both grant and refuse paths.
- ☑ `tests/regression/test_autonomy_provenance_trail.py` — autonomous decisions land in `provenance/agent_trace.md`; tests assert completeness.
- ☑ `tests/regression/test_autonomy_no_validated_without_evidence.py` — autonomous run with missing coefficient data produces an `exploratory` capsule, NOT `validated` (plan §22).
- ☑ `examples/autonomous_experiment_kr/` — end-to-end example that produces a real capsule.
- ☑ `program_development/architectural_decisions/ADR-0007-autonomous-budget-governance.md`.
- ☑ `docs_site/src/content/agent_workflows.tsx` updated to describe the autonomous pipeline.
- ☑ FastAPI endpoints for autonomous design / smoke / sweep / review (`POST /api/autonomy/{action}`) wired through `simworkbench.api.server`.
- ☑ UI panel for autonomous pipeline (`apps/workbench-ui/src/components/autonomy/`).

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 10 row, `timeline.md`, `configs/agents.yaml`, the new budget-governance ADR, and any docs page that named "Phase 10 — pending". Bump `<p className="phase-tag">Phase 9</p>` → `Phase 10` in `apps/workbench-ui/src/App.tsx`.

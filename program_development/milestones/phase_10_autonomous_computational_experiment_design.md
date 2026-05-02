# Phase 10 — Autonomous Computational Experiment Design

**Status: Not started**

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

Starting-point hints from plan §Phase 10:

- ☐ `packages/agent_orchestration/src/experiment_design/__init__.py` — agentic experiment planner emitting plans with minimum viable model, fidelity ladder, cost estimate, diagnostics, and validation path.
- ☐ `packages/agent_orchestration/src/autonomous_runs/__init__.py` — bounded smoke-run executor with diagnostic interpretation and instability detection.
- ☐ `packages/agent_orchestration/src/sweep_agent/__init__.py` — controlled sweep agent honoring budget caps from `configs/agents.yaml`.
- ☐ `packages/agent_orchestration/src/review_agents/scientific_review.py` — agent that critiques assumptions, flags missing physics, and compares to literature.
- ☐ Approval gates wired and tested: trusted-module promotion, expensive runs, external export, destructive edits all require human approval and refuse otherwise.
- ☐ `configs/agents.yaml` — `orchestrator`, `experiment_design`, `controlled_sweep`, `scientific_review` roles flipped to `enabled: true` with explicit budget caps and refusal sets.
- ☐ Regression tests in `tests/regression/` cover every approval gate (each gate explicitly tested with both grant and refuse paths).
- ☐ Provenance: every autonomous decision is logged in the capsule's `provenance/agent_trace.md`. Tests assert the trace exists and is complete after an autonomous run.
- ☐ Plan §22 ("Scientific Accuracy Policy") explicitly tested against the autonomous pipeline — at least one regression test asserts that an autonomous run with missing coefficient data produces an `exploratory` capsule, not a `validated` one.
- ☐ ADR on autonomous-run budget governance.

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 10 row, `timeline.md`, `configs/agents.yaml`, the new budget-governance ADR, and any docs page that named "Phase 10 — pending".

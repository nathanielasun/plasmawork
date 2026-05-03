# Phase 6 — Agentic Code Generation in Sandboxed Capsules

**Status: Complete (2026-05-03).** All five workstreams 6A–6E shipped. Default convention checker green at 435 checks; opt-in mode reports no open workstreams.

## Objective
Allow agents to generate candidate experiment code inside simulation capsules, run tests, and produce reviewable results. (Plan §Phase 6.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 6A | Code Generation Backend | generated Python experiment code, configs, diagnostics, tests, docs, readable structure |
| 6B | Code Sandbox | isolate generated code, restrict writes, prevent destructive edits, track generated files, show regeneration diffs |
| 6C | Test Generation | unit, dimensional, smoke, convergence, and regression hooks where appropriate |
| 6D | Generated Code Viewer and Editor | show code, track user edits separately, prevent silent overwrites, support export |
| 6E | Validation Run | small simulation, diagnostics, plots, validation summary, validation status |

## Phase Gate
Phase 6 is complete when an agent can generate a runnable, reviewable, editable, exportable simulation from a ModelSpec inside a capsule.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

Starting-point hints from plan §Phase 6:

- ☐ `packages/agent_orchestration/src/code_generation/__init__.py` — code generator that targets a capsule sandbox.
- ☐ Sandbox enforcement: code generation writes only to `<capsule>/src/generated/`. Tests that assert this is the case (no writes to `user_edits/`, `paper_sources/`, `provenance/`).
- ☐ `packages/agent_orchestration/src/test_generation/__init__.py` — emits unit, dimensional, smoke, and regression tests.
- ☐ Generated-code viewer in `apps/workbench-ui/` shows diffs and prevents `user_edits/` overwrites; user-edit tracking surfaced in provenance.
- ☐ At least one full agent-generated capsule passes its own validation (dimensional, conservation if applicable, smoke, plot generation, validation summary).
- ☐ `configs/agents.yaml` — `code_generation`, `numerical_methods`, `validation`, `visualization` roles flipped to `enabled: true`.
- ☐ Regression test: regeneration of a capsule does not modify `<capsule>/src/user_edits/` (covers `agent_error_patterns.md` "Overwriting user_edits/").
- ☐ `tests/integration/test_capsule_codegen.py`, `tests/regression/test_user_edits_preserved_on_regeneration.py`.

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 6 row, `timeline.md`, `configs/agents.yaml`, and any docs page that named "Phase 6 — pending".

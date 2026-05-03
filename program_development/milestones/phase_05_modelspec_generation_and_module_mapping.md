# Phase 5 — ModelSpec Generation and Module Mapping

**Status: Complete (opened 2026-05-03; closed 2026-05-03). All four workstreams 5A, 5B, 5C, 5D shipped.**

## Objective
Convert interpreted papers into validated ModelSpecs and map them to available modules. (Plan §Phase 5.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 5A | ModelSpec Generator | paper interpretation to ModelSpec, schema validation, species/interactions/geometry/BC resolution, missing-field flags |
| 5B | Module Retrieval | registry search, domain/regime match, I/O compatibility, unit compatibility, solver compatibility |
| 5C | Gap Analysis | missing modules/data, unsupported regimes, invalid solver choices, validation gaps |
| 5D | Experiment Proposal | minimal simulation, fidelity extensions, cost estimate, validation path, backend recommendation |

## Phase Gate
Phase 5 is complete when the system can transform a reviewed paper interpretation into a validated ModelSpec and a proposed experiment plan.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

Starting-point hints from plan §Phase 5:

- ☑ `packages/agent_orchestration/src/model_spec_generation/__init__.py` — generator that emits a schema-valid ModelSpec.
- ☑ `packages/agent_orchestration/src/model_spec_generation/repair.py` — automatic repair loop on validator failures.
- ☑ `packages/agent_orchestration/src/module_retrieval/__init__.py` — registry search by required physics with unit / regime / I/O compatibility checks.
- ☑ `packages/agent_orchestration/src/gap_analysis/__init__.py` — gap report generator producing the five gap categories from plan §10.4.
- ☑ `packages/agent_orchestration/src/experiment_planning/__init__.py` — experiment-proposal generator (`experiment_proposal.md`).
- ☑ `configs/agents.yaml` — `model_spec`, `module_retrieval` roles flipped to `enabled: true`.
- ☑ End-to-end test: one Phase-4 interpretation artifact set is converted into a schema-valid ModelSpec, mapped to existing modules, and a gap report is produced.
- ☑ `tests/integration/test_modelspec_generation.py`, `tests/integration/test_module_retrieval.py`, `tests/integration/test_gap_analysis.py`.
- ☑ Experiment proposal UI accessible from `apps/workbench-ui/`.

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 5 row, `timeline.md`, `configs/agents.yaml`, and any docs page that named "Phase 5 — pending".

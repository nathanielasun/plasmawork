# Phase 5 — ModelSpec Generation and Module Mapping

**Status: Not started**

> Note: the plan numbers Phase 5 as "ModelSpec Generation and Module Mapping" (plan §Phase 5). The filename keeps the original plan's placeholder convention; the content below tracks the actual Phase 5.

## Objective
Convert interpreted papers into validated ModelSpecs and map them to available modules. (Plan §Phase 5.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 5A | ModelSpec Generator | paper interpretation → ModelSpec; schema validation; resolve species, interactions, geometry, BCs; flag missing fields |
| 5B | Module Retrieval | search registry by required physics; match domains/regimes; compare I/O and units |
| 5C | Gap Analysis | missing modules, missing data, unsupported regimes, invalid solver choices, validation gaps |
| 5D | Experiment Proposal | propose minimal sim, propose extensions, estimate cost, identify validation path, recommend backend |

## Phase Gate
Phase 5 is complete when the system can transform a reviewed paper interpretation into a validated ModelSpec and a proposed experiment plan.

## Phases 6–10 (placeholders, to be filled when work begins)

The plan defines five further phases (Phase 6 sandboxed agentic codegen, Phase 7 validated registry, Phase 8 HPC backends, Phase 9 sweeps/optimization/UQ, Phase 10 autonomous bounded experiments). Milestone files for those will be created when their phases begin so the documentation reflects current scope rather than speculative scope.

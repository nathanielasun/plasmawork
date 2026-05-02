# Phase 6 — Agentic Code Generation in Sandboxed Capsules

**Status: Not started**

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

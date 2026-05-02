# Phase 1 — Manual Scientific Workbench

**Status: Not started**

## Objective
Build a functioning non-agentic workbench that can define, run, pause, save, load, visualize, and export simple scientific simulations. (Plan §Phase 1.)

## Workstreams (parallelizable)

| ID | Title | Notes |
|---|---|---|
| 1A | Core Experiment Model | `Experiment`, `ModelSpec`, `RunConfig`, `DiagnosticConfig`, `BackendConfig`, serialization |
| 1B | Units and Quantities | Units library integration; dimensional validation in ModelSpec |
| 1C | Simulation Runtime | start/stop/pause/resume, checkpointing, deterministic seeds, event/log system |
| 1D | Basic Physics Modules | Gaussian laser pulse, basic species, 0D rate-equation solver, simple absorption/emission, LJ MD example, 2D Ising example |
| 1E | Visualization and Diagnostics | line plots, heatmaps, particle scatter, statistics, live streaming |
| 1F | UI Workbench | TS UI shell, simulation list, run controls, code/docs viewers, diagnostics & plot panels, capsule explorer |

## Phase Gate

Phase 1 is complete when a user can:

1. Create a simple experiment manually.
2. Run it locally.
3. Pause and resume it.
4. Save it as a capsule.
5. Reload it.
6. View code/configuration.
7. Plot diagnostics.
8. Read documentation from inside the UI.

## Pending decisions (carried in from Phase 0)
- Units library: `pint` vs. `astropy.units` vs. custom wrapper. Will be decided at the start of Workstream 1B with an ADR.
- UI framework choice for `apps/workbench-ui`.

## Open questions
- How are capsules surfaced in the UI before Phase 2 finalizes the format? Likely: the capsule explorer reads the directory format directly even before the manifest schema is frozen.

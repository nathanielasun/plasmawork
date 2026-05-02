# Phase 2 — Simulation Capsule System

**Status: Not started**

> Note: the plan numbers Phase 2 as "Simulation Capsule System" (plan §Phase 2). The filename keeps the original plan's `phase_02_agent_assisted_generation.md` placeholder convention but the **content** below tracks the actual Phase 2 from the plan. If the project later wants to rename the file to `phase_02_simulation_capsule_system.md`, that's a documentation-only change.

## Objective
Make reproducible simulation capsules the central project artifact. (Plan §Phase 2.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 2A | Capsule Format | `.lxp/` layout, `manifest.toml`, internal paths, versioning, migration hooks. Locks HDF5 vs Zarr. |
| 2B | Provenance System | `provenance.lock`, agent trace, environment capture |
| 2C | Export System | Python code, kernels, data, plots, notebook, report, archive |
| 2D | Capsule UI | Capsule explorer in the workbench UI |

## Phase Gate
Phase 2 is complete when capsules are portable, inspectable, reloadable, and exportable.

## Decisions to make in this phase
- Lock the bulk numerical format (HDF5 vs Zarr) — finalize ADR-0002.
- Decide JSON vs TOML for `provenance.lock`.

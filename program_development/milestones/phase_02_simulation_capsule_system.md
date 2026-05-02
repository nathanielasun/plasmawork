# Phase 2 — Simulation Capsule System

**Status: Not started**

## Objective
Make reproducible simulation capsules the central project artifact. (Plan §Phase 2.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 2A | Capsule Format | `.lxp/` layout, `manifest.toml`, internal paths, versioning, migration hooks |
| 2B | Provenance System | `provenance.lock`, agent trace, environment capture, backend/runtime metadata |
| 2C | Export System | Python code, kernels, data, plots, notebooks, reports, compressed capsule archives |
| 2D | Capsule UI | Capsule explorer, manifest, ModelSpec, code, results, validation status, provenance |

## Phase Gate
Phase 2 is complete when capsules are portable, inspectable, reloadable, and exportable.

## Decisions to make in this phase
- Lock the bulk numerical format (HDF5 vs. Zarr) and finalize ADR-0002.
- Decide JSON vs. TOML for `provenance.lock`.

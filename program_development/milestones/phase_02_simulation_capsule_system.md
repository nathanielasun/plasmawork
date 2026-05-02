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

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

Starting-point hints from plan §Phase 2:

- ☐ `packages/core/src/simworkbench/serialization/manifest.py` — `manifest.toml` schema and validator.
- ☐ `packages/core/src/simworkbench/serialization/capsule_validator.py` — full directory-form validator covering every required subdirectory and file.
- ☐ `packages/core/src/simworkbench/provenance/lock.py` — provenance writer (`provenance.lock`, `environment.yaml`, `agent_trace.md`).
- ☐ ADR-0002 transitions `Proposed` → `Accepted` with the chosen bulk format (HDF5 or Zarr) recorded.
- ☐ `scripts/export/capsule.sh` is a real implementation (no longer a Phase-0 stub).
- ☐ `scripts/export/fork_capsule.sh` exists and creates a forked capsule whose provenance references the parent's hash.
- ☐ At least one capsule under `examples/<domain>/<name>.lxp/` validates clean and round-trips through save → reload → diff.
- ☐ Capsule explorer in `apps/workbench-ui/` renders manifest, ModelSpec, code, results, validation status, and provenance.
- ☐ `docs_site/src/content/simulation_capsules.tsx` Phase-0 banner replaced with the finalized format reference.
- ☐ `tests/integration/test_capsule_roundtrip.py`, `tests/integration/test_capsule_fork.py`, `tests/regression/test_user_edits_not_overwritten.py`.

### Status sync at close

Flip the status in one commit that touches this milestone, `README.md` Phase 2 row, `timeline.md`, ADR-0002, and any docs page that named "Phase 2 — pending".

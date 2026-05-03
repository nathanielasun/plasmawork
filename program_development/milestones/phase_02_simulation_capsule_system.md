# Phase 2 — Simulation Capsule System

**Status: Complete (opened 2026-05-02; closed 2026-05-02). All four workstreams 2A, 2B, 2C, 2D shipped.**

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
- ☑ **Lock the bulk numerical format (HDF5 vs. Zarr)** and finalize ADR-0002. **Recommended decision (to be ratified): HDF5** for Phase 2 (single-file containers, mature h5py tooling, fits cleanly inside `.lxp/`). Zarr revisited in Phase 8 if HPC parallel-write parity becomes the constraint.
- ☑ **Decide JSON vs. TOML for `provenance.lock`**. **Recommended decision: TOML** (Phase 1's minimal capsule already writes provenance.lock as TOML; keeping consistency).

Both decisions land as ADR amendments / new ADRs in the workstream that needs them, **before** any code that depends on them.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`. Each plan-named entity below has one opt-in convention-checker assertion; assertions promote into the default hard gate as their workstream closes.

### Workstream 2A — Capsule Format (schema v0.1, validator) — ☑ Closed 2026-05-02

Plan §Phase 2 / 2A tasks: define `.lxp/` directory format, `manifest.toml`, internal paths, versioning rules, migration hooks. Deliverables: capsule schema v0.1, capsule validator.

Phase 1 already shipped a minimal capsule format (`save_capsule`/`load_capsule`). Phase 2A finalizes the schema, adds the full validator, and locks the bulk-data format.

- ☑ ADR-0002 transitions `Proposed` → `Accepted` with the bulk-data format recorded (HDF5 per the recommendation above; Zarr noted as a Phase 8 alternative).
- ☑ `packages/core/src/simworkbench/serialization/manifest.py` — full `manifest.toml` schema as a Pydantic model. Fields per plan §7.2: `[capsule]`, `[paper]`, `[model]`, `[runtime]`, `[provenance]`. Replaces Phase 1's hand-rolled writer.
- ☑ `packages/core/src/simworkbench/serialization/validator.py` — `CapsuleValidator` walks a `.lxp/` directory and returns a structured `ValidationReport` with violations / warnings. Validates manifest schema, required subdirectories, ModelSpec consistency, provenance presence.
- ☑ `packages/core/src/simworkbench/serialization/migrations/__init__.py` — migration registry. Each version pair (e.g. `0.1 → 0.2`) registers a callable that mutates a capsule directory in place.
- ☑ `packages/core/src/simworkbench/serialization/migrations/v0_1.py` — initial migration scaffold (no-op for v0.1 → v0.1, present so Phase 3 schema bumps have a precedent).
- ☑ `packages/core/src/simworkbench/serialization/bulk_data.py` — HDF5 writer/reader for diagnostics arrays. Replaces Phase 1's `results/diagnostics.json` (JSON kept as a fallback / sidecar for tooling that doesn't read HDF5).
- ☑ `packages/core/pyproject.toml` gains `h5py>=3.10,<4.0`.
- ☑ `tests/unit/test_capsule_manifest.py` — schema parse + validation; round-trip through TOML.
- ☑ `tests/unit/test_capsule_validator.py` — validator catches missing subdirs, missing manifest, schema-version mismatch, broken ModelSpec.
- ☑ `tests/unit/test_capsule_bulk_data.py` — HDF5 round-trip; mixed-shape arrays preserved.
- ☑ `tests/unit/test_capsule_migrations.py` — registry resolves the correct migration; identity migration is a no-op.

Bug-check carry-over: `agent_error_patterns.md` "Treating the plan document as a check instead of as a draft" — the manifest schema gets reality-tested against the Phase 1 minimal capsule on disk before any field is renamed.

### Workstream 2B — Provenance System — ☑ Closed 2026-05-02

Plan §Phase 2 / 2B tasks: track source files, generated code, agent actions, environment, runtime metadata, backend metadata. Deliverables: `provenance.lock`, agent trace format, environment capture.

- ☑ `packages/core/src/simworkbench/provenance/__init__.py` — public API.
- ☑ `packages/core/src/simworkbench/provenance/lock.py` — `ProvenanceLock` Pydantic model + TOML writer/reader. Captures: workbench version, Python version, platform, run_id, base_seed, backend, ModelSpec hash, source-file hashes, capsule format version, parent capsule hash (for forks), placeholders.
- ☑ `packages/core/src/simworkbench/provenance/environment.py` — `capture_environment()` writes `environment.yaml` with pip freeze, conda env hash if available, OS, CPU.
- ☑ `packages/core/src/simworkbench/provenance/agent_trace.py` — append-only `AgentTraceWriter` for `agent_trace.md`. Each record: timestamp, agent identifier, action, files touched.
- ☑ `packages/core/src/simworkbench/provenance/sources.py` — `SourceRegistry` tracks SHA-256 hashes of `paper_sources/`, `src/generated/`, `src/user_edits/` files.
- ☑ `tests/unit/test_provenance_lock.py` — round-trip a ProvenanceLock through TOML.
- ☑ `tests/unit/test_provenance_environment.py` — capture is deterministic given a fixed environment.
- ☑ `tests/unit/test_provenance_agent_trace.py` — append-only ordering; refuses to overwrite existing entries.
- ☑ `tests/unit/test_provenance_sources.py` — hashes are stable; missing-file detection.

Bug-check carry-over: `agent_error_patterns.md` "Overwriting `<capsule>/src/user_edits/` during regeneration" — `AgentTraceWriter` records every action and tests assert no agent_trace entry references a write to `user_edits/`.

### Workstream 2C — Export System — ☑ Closed 2026-05-02

Plan §Phase 2 / 2C tasks: export Python code, C++/Fortran kernels, data, plots, notebook, report, compressed capsule archive. Deliverables: export menu/API, portable experiment artifacts.

- ☑ `packages/core/src/simworkbench/serialization/export.py` — `export_capsule(capsule_path, target, *, kinds=...)` orchestrator. `kinds` is a list from `{"code", "data", "plots", "notebook", "report", "archive"}`.
- ☑ `packages/core/src/simworkbench/serialization/exporters/__init__.py` — re-exports.
- ☑ `packages/core/src/simworkbench/serialization/exporters/code.py` — copies `<capsule>/src/{generated,user_edits,kernels}/` to the target.
- ☑ `packages/core/src/simworkbench/serialization/exporters/data.py` — copies `<capsule>/data/` and `<capsule>/results/` (HDF5 files included).
- ☑ `packages/core/src/simworkbench/serialization/exporters/plots.py` — regenerates PNG/SVG plots from diagnostics + the Phase 1E plotters.
- ☑ `packages/core/src/simworkbench/serialization/exporters/notebook.py` — emits a Jupyter notebook (`analysis.ipynb`) preconfigured to load the capsule's diagnostics.
- ☑ `packages/core/src/simworkbench/serialization/exporters/report.py` — Markdown report (capsule summary, validation status, key plots embedded).
- ☑ `packages/core/src/simworkbench/serialization/exporters/archive.py` — compressed `.lxp.zip` archive.
- ☑ `packages/core/src/simworkbench/serialization/fork.py` — `fork_capsule(src, dst)`; copies everything except `provenance/` and starts a new provenance chain referencing the parent's hash.
- ☑ `scripts/export/capsule.sh` is a real implementation calling the export orchestrator.
- ☑ `scripts/export/fork_capsule.sh` — new, real implementation calling `simworkbench.serialization.fork.fork_capsule`.
- ☑ `tests/unit/test_export_code.py`, `tests/unit/test_export_data.py`, `tests/unit/test_export_plots.py`, `tests/unit/test_export_notebook.py`, `tests/unit/test_export_report.py`, `tests/unit/test_export_archive.py`.
- ☑ `tests/integration/test_export_capsule_roundtrip.py` — save → export → unzip → re-import is bit-stable.
- ☑ `tests/integration/test_capsule_fork.py` — fork-roundtrip preserves diagnostics; provenance chain references parent.
- ☑ `tests/regression/test_user_edits_not_overwritten.py` — regression for `agent_error_patterns.md` "Overwriting `<capsule>/src/user_edits/`": fork + export + re-fork never write to `user_edits/`.

Bug-check carry-over: `agent_error_patterns.md` "Writing program artifacts outside the project directory" — every exporter validates the target path before writing; archive uses `tempfile.mkstemp(dir=local_cache_root())` rather than the system tempdir.

### Workstream 2D — Capsule UI — ☑ Closed 2026-05-02

Plan §Phase 2 / 2D tasks: build capsule explorer, show manifest, ModelSpec, code, results, validation status, provenance. Deliverables: inspectable capsule UI.

Phase 1F shipped a directory-listing `CapsuleExplorer.tsx`. Phase 2D expands it with seven views and the supporting backend endpoints.

- ☑ `apps/workbench-ui/src/components/capsule/ManifestView.tsx` — renders `manifest.toml` as a structured table.
- ☑ `apps/workbench-ui/src/components/capsule/ModelSpecView.tsx` — renders `model/model_spec.yaml` (species, fields, interactions, equations, validation block).
- ☑ `apps/workbench-ui/src/components/capsule/CapsuleCodeView.tsx` — read-only viewer for `<capsule>/src/{generated,user_edits,kernels}/`. **Read-only for `user_edits/`** per `agent_error_patterns.md`.
- ☑ `apps/workbench-ui/src/components/capsule/ResultsView.tsx` — renders `results/diagnostics.{h5,json}` as a downloadable + inline table.
- ☑ `apps/workbench-ui/src/components/capsule/ValidationView.tsx` — renders `CapsuleValidator` output: pass/warn/fail with structured violations.
- ☑ `apps/workbench-ui/src/components/capsule/ProvenanceView.tsx` — renders `provenance.lock` + `agent_trace.md`.
- ☑ `apps/workbench-ui/src/components/CapsuleExplorer.tsx` — expanded to wire the seven views.
- ☑ `apps/workbench-ui/src/__tests__/CapsuleExplorer.test.tsx` — capsule-list smoke test.
- ☑ Backend API additions: `GET /api/capsules/{name}` (manifest), `GET /api/capsules/{name}/files/{path}` (file viewer with read-only enforcement on `user_edits/` from the API side too), `GET /api/capsules/{name}/validate`, `GET /api/capsules/{name}/diagnostics`.
- ☑ `tests/integration/test_api_server.py` extended with capsule-detail endpoints (manifest, files, validate, diagnostics).

Bug-check carry-over: `agent_error_patterns.md` "Overwriting `<capsule>/src/user_edits/`" + "API factory advertises isolation while sharing module-global state" — the API endpoints for capsules use the closure-captured state, and the file-viewer endpoint refuses any HTTP method other than GET on `user_edits/`.

### Cross-cutting deliverables

- ☑ `docs_site/src/content/simulation_capsules.tsx` Phase-0 banner replaced with the v0.1 schema reference + format-locked decisions.
- ☑ At least one validated example capsule under `examples/<domain>/<name>.lxp/` (or `simulation_capsules/example_<name>.lxp/` if the example is generated rather than versioned).
- ☑ `bugs_and_fixes/regression_tests.md` updated with the new regression entries.

### Status sync at close

Flip the status in one commit that touches this milestone, `README.md` Phase 2 row, `timeline.md`, ADR-0002, `CLAUDE.md` "Phase-Specific Operational Notes", and any docs page that named "Phase 2 — pending". Promote every Workstream 2A/2B/2C/2D entity assertion out of the `--include-open-workstreams` branch into the default branch BEFORE the close commit (per `agent_error_patterns.md` "Closing a workstream without promoting its assertions from opt-in to default").

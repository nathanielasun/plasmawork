# Phase 1 — Manual Scientific Workbench

**Status: In progress (started 2026-05-02). Active workstreams: 1A, 1B.**

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
- ~~Units library: `pint` vs. `astropy.units` vs. custom wrapper~~ — **resolved 2026-05-02 in ADR-0004 (`pint`)**.
- UI framework choice for `apps/workbench-ui` — deferred to Workstream 1F kickoff.

## Open questions
- How are capsules surfaced in the UI before Phase 2 finalizes the format? Likely: the capsule explorer reads the directory format directly even before the manifest schema is frozen.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

The agent opening Phase 1 translates each deliverable below into an assertion in `scripts/dev/check_repo_conventions.sh`. Starting-point hints, drawn from plan §Phase 1 — replace stubs with real implementations as workstreams complete:

- ☑ `packages/core/pyproject.toml` populated with the runtime's actual dependencies (no longer a Phase-0 placeholder). *Done 2026-05-02 (Workstream 1B).*
- ☑ `packages/core/src/simworkbench/model_spec/schema.py` — `ModelSpec` types + JSON schema (per ADR-0003). *Done 2026-05-02 (Workstream 1A): `model_spec/{__init__,types,loader,schema}.py`. Pydantic v2 IR with custom `Quantity` field bridging to `simworkbench.units`. 20 ModelSpec tests passing.*
- ☑ `packages/core/src/simworkbench/units/__init__.py` — units library wrapper, dimensional validation entrypoints. *Done 2026-05-02 (Workstream 1B): `units/{__init__,registry,quantity,validators}.py`, 30 unit tests passing.*
- ☐ `packages/core/src/simworkbench/runtime/runner.py` — start / pause / resume / checkpoint API.
- ☐ `packages/core/src/simworkbench/serialization/capsule.py` — minimal capsule save/load (Phase 2 finalizes the format).
- ☐ `packages/physics_modules/laser/gaussian_pulse/{module.yaml,src/}` — first physics module (per ADR-0001 laser focus).
- ☐ `packages/physics_modules/species/<basic>/{module.yaml,src/}` — basic species module.
- ☐ `examples/simple_rate_equations/run.py` — first laser-species example, runnable end-to-end. *(YAML model spec landed Workstream 1A; runtime to wire it up lands in Workstream 1C.)*
- ☐ `examples/ising_phase_transition/run.py` *or* `examples/molecular_dynamics/run.py` — second-domain proof per ADR-0001.
- ☐ `scripts/dev/run_backend.sh` and `scripts/dev/run_ui.sh` are real implementations (no longer Phase-0 stubs).
- ☑ `tests/unit/test_modelspec.py`, ☑ `tests/unit/test_units.py`, ☐ `tests/integration/test_capsule_save_load.py`.
- ☐ `apps/workbench-ui/src/app/page.tsx` is a real workbench shell with simulation list, run controls, code/docs viewers, diagnostics panel, plot panel, capsule explorer.
- ☐ Every `docs_site/src/content/*.tsx` page that has a Phase-1 banner has been updated and re-banner'd.

Add more as workstreams evolve. The checker is the source of truth for "phase complete" — markdown checkboxes alone are aspirational.

### Status sync at close

Flip the status to `Complete` only in a single commit that touches every place it is mirrored: this milestone (Status header + Phase Gate boxes), `README.md` Current Development Status table, `program_development/timeline.md`, any new ADR Status field, any `module.yaml` lifecycle field that transitioned, and any `docs_site/src/content/*.tsx` page that named "Phase 1 — pending" anywhere.

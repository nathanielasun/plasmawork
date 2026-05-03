# Phase 1 — Manual Scientific Workbench

**Status: Complete (2026-05-02, after review-fix sweep). All six workstreams 1A–1F shipped, all seven review-finding fixes landed, default convention checker covers every Phase 1 entity, all 207 tests pass, ruff clean.**

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

1. ☑ Create a simple experiment manually. *(Workstream 1A — `Experiment.from_model_spec`.)*
2. ☑ Run it locally. *(Workstream 1C — `Runner.run` against the `python_cpu` backend.)*
3. ☑ Pause and resume it. *(Workstream 1C — pause/resume identity test passes.)*
4. ☑ Save it as a capsule. *(`simworkbench.serialization.capsule.save_capsule` writes a real `.lxp/` directory under `simulation_capsules/`. 6 round-trip tests pass. Phase 2 will lock the bulk-data format per ADR-0002.)*
5. ☑ Reload it. *(`simworkbench.serialization.capsule.load_capsule` reconstructs the experiment + diagnostics from the capsule.)*
6. ☑ View code/configuration. *(Workstream 1F — CodeViewer panel.)*
7. ☑ Plot diagnostics. *(Workstream 1E + 1F — server-side plotters in `simworkbench.diagnostics.plotters` and the in-browser PlotPanel.)*
8. ☑ Read documentation from inside the UI. *(Workstream 1F — DocsViewer loads from `docs_site/src/content/*.tsx` via the `@docs` Vite alias; no duplication.)*

All eight gate criteria are now genuinely satisfied. The earlier close commit (`37132a5`) had marked items 4 and 5 as Phase-2 deferrals without ADR authority — see `agent_error_patterns.md` *Unilaterally redefining a Phase Gate item during the close*. The fix is in this milestone: Phase 1 ships a minimal-but-real `.lxp/` capsule format (per Phase 1 close), and Phase 2 finalizes the bulk-data choice (HDF5 vs Zarr per ADR-0002) plus the full provenance/fork/export tooling.

## Pending decisions (carried in from Phase 0)
- ~~Units library: `pint` vs. `astropy.units` vs. custom wrapper~~ — **resolved 2026-05-02 in ADR-0004 (`pint`)**.
- UI framework choice for `apps/workbench-ui` — deferred to Workstream 1F kickoff.

## Open questions
- How are capsules surfaced in the UI before Phase 2 finalizes the format? Likely: the capsule explorer reads the directory format directly even before the manifest schema is frozen.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

Each workstream's deliverable list below is enumerated from `scientific_simulation_workbench_agent_plan.md` `§Phase 1 → Workstream 1X`, not from agent intuition. Open entities correspond to opt-in assertions in `scripts/dev/check_repo_conventions.sh --include-open-workstreams`; completed entities move into the default `scripts/dev/check_repo_conventions.sh` hard gate. The checker is the source of truth for completion — markdown checkboxes alone are aspirational.

#### Workstream 1A — Core Experiment Model — ☑ Implementation landed 2026-05-02

- ☑ `packages/core/pyproject.toml` populated with real dependencies (no longer Phase-0 placeholder).
- ☑ `packages/core/src/simworkbench/model_spec/{__init__,types,loader,schema}.py` — Pydantic v2 IR per ADR-0003 with hardened validators (raw-number rejection in flexible parameter trees, missing-species, unknown equation refs, missing coefficient sources, unsupported backends, unknown validity-regime keys, unitless domain bounds).
- ☑ `packages/core/src/simworkbench/experiment/{__init__,types}.py` — `Experiment`, `RunConfig`, `DiagnosticConfig`, `BackendConfig`.
- ☑ `packages/core/src/simworkbench/serialization/{__init__,experiment}.py` — experiment YAML save/load. (Capsule save/load remains Phase 2.)
- ☑ `examples/simple_rate_equations/model.yaml` — first laser-species ModelSpec.
- ☑ `tests/unit/test_modelspec.py`, ☑ `tests/unit/test_experiment.py`, ☑ `tests/integration/test_experiment_save_load.py`.

#### Workstream 1B — Units and Quantities — ☑ Implementation landed 2026-05-02

- ☑ `packages/core/src/simworkbench/units/{__init__,registry,quantity,validators}.py` — `pint` wrapper per ADR-0004, workbench unit registry with laser-physics aliases, ModelSpec boundary hardening.
- ☑ `tests/unit/test_units.py`.

#### Workstream 1C — Simulation Runtime — ☑ Closed 2026-05-02

Plan §Phase 1 / Workstream 1C tasks: start/stop/pause/resume, checkpointing, deterministic seed handling, event/log system, progress reporting. Deliverables: local simulation runner, checkpoint and restore.

Per-entity TODO assertions tracked while this workstream is open:

- ☑ `packages/core/src/simworkbench/runtime/__init__.py` — package entrypoint exporting Runner.
- ☑ `packages/core/src/simworkbench/runtime/runner.py` — start/stop/pause/resume API. Driven by an `Experiment` and a backend.
- ☑ `packages/core/src/simworkbench/runtime/checkpoint.py` — checkpoint write/restore. **All checkpoint paths resolve under `temp_runs/<run_id>/checkpoints/` or the owning capsule's `results/checkpoints/`** — never `/tmp/`, never `~/`. Honors `bugs_and_fixes/agent_error_patterns.md` "Writing program artifacts outside the project directory".
- ☑ `packages/core/src/simworkbench/runtime/seeds.py` — deterministic seed handling. Per-run seeds derived from `runtime.default_seed` in `configs/default.yaml`.
- ☑ `packages/core/src/simworkbench/runtime/events.py` — event/log system. Structured events written to the workbench logger; format consistent with `bugs_and_fixes/program.log.example`.
- ☑ `packages/core/src/simworkbench/runtime/progress.py` — progress reporting (callback or generator interface; consumed by 1F UI later).
- ☑ `packages/core/src/simworkbench/paths/__init__.py` — workbench path helpers (`local_cache_root`, `temp_runs_root`, `temp_imports_root`, `simulation_capsules_root`). Required so 1C can resolve checkpoint paths without ad-hoc string concatenation.
- ☑ `tests/unit/test_runtime_runner.py` — start/stop/pause/resume invariants.
- ☑ `tests/unit/test_runtime_checkpoint.py` — round-trip checkpoint write/restore.
- ☑ `tests/unit/test_runtime_seeds.py` — same seed → same trajectory; different seeds → different trajectories.
- ☑ `tests/unit/test_runtime_events.py` — event ordering and serialization.
- ☑ `tests/unit/test_runtime_progress.py` — progress callbacks/generator reports monotonic progress and terminal completion.
- ☑ `tests/unit/test_paths.py` — path helpers resolve relative to repo root, not user home.
- ☑ `tests/integration/test_runtime_pause_resume.py` — pause/resume preserves identity (resume of a checkpoint reproduces the original trajectory bit-for-bit on `python_cpu`).
- ☑ `tests/regression/test_runtime_writes_only_to_temp_runs.py` — regression for the `agent_error_patterns.md` "Writing program artifacts outside the project directory" pattern.
- ☑ `scripts/dev/run_backend.sh` becomes a real implementation (no longer Phase-0 stub). The opt-in checker must fail while the stub message remains.
- ☑ `examples/simple_rate_equations/run.py` runs the YAML model end-to-end and writes a checkpoint+result under `temp_runs/`.

Bug-check carry-over from `bugs_and_fixes/agent_error_patterns.md`:
- *Replacing validated solver calls with naive generated loops* — the rate-equation runner uses `scipy.integrate.solve_ivp` (or an equivalent validated stiff solver), not a hand-rolled `for t in range(...)` loop.
- *Switching backends to make output "look better"* — runtime backend selection follows `configs/backends.yaml` and the experiment's `backend_config`, never visual-quality heuristics.

#### Workstream 1D — Basic Physics Modules — ☑ Closed 2026-05-02

Plan §Phase 1 / Workstream 1D initial modules (one per item): Gaussian laser pulse, Basic species definition, 0D rate-equation solver, Simple absorption model, Simple emission model, Lennard-Jones MD example, 2D Ising model example. Deliverables: minimal validated modules + example simulations.

Each module follows the AGENTS.md Module SDK layout: `module.yaml`, `src/`, `tests/`, `README.md`, `assumptions.md`, `validity_domain.md`, `equations.md`, `changelog.md`, `examples/`. The opt-in convention checker asserts the full starter template and `module.yaml` + `README.md` + the primary unit test per module; the rest are required by the module template and reviewed before module status flips `draft → candidate`.

Per-entity assertions:

- ☑ `packages/physics_modules/templates/module_template/{module.yaml,src/__init__.py,tests/test_template.py,README.md}` — canonical template used to scaffold new modules.
- ☑ `packages/physics_modules/laser/gaussian_pulse/{module.yaml,README.md}` + `tests/unit/test_gaussian_pulse.py`. Per ADR-0001 laser focus; first physics module.
- ☑ `packages/physics_modules/species/basic/{module.yaml,README.md}` + `tests/unit/test_basic_species.py`. Defines an atomic/ionic species with charge, mass, internal-state list.
- ☑ `packages/physics_modules/species/rate_equation_0d/{module.yaml,README.md}` + `tests/unit/test_rate_equation_0d.py`. 0D solver wrapping `scipy.integrate.solve_ivp` (LSODA). **Honors the "validated solver, not naive loop" pattern.**
- ☑ `packages/physics_modules/laser/simple_absorption/{module.yaml,README.md}` + `tests/unit/test_simple_absorption.py`. Linear-regime absorption with explicit assumptions.
- ☑ `packages/physics_modules/laser/simple_emission/{module.yaml,README.md}` + `tests/unit/test_simple_emission.py`. Spontaneous emission with explicit lifetime input.
- ☑ `packages/physics_modules/molecular_dynamics/lennard_jones/{module.yaml,README.md}` + `tests/unit/test_lennard_jones.py`. LJ MD example — second-domain proof per ADR-0001 generality requirement.
- ☑ `packages/physics_modules/phase_transition/ising_2d/{module.yaml,README.md}` + `tests/unit/test_ising_2d.py`. 2D Ising example — third-domain proof.
- ☑ `examples/simple_rate_equations/run.py` — wires the existing `model.yaml` + 1C runtime + 1D modules into a runnable script. (Crosses Workstreams 1C and 1D; asserted once in the checker to avoid duplicate failures for the same file.)
- ☑ `examples/molecular_dynamics/run.py` — runnable LJ MD example.
- ☑ `examples/ising_phase_transition/run.py` — runnable Ising example.
- ☑ `tests/validation/test_rate_equation_conservation.py` — particle-conservation invariant for the rate-equation example (validates the laser-species example).
- ☑ `tests/validation/test_lennard_jones_energy_drift.py` — energy-drift bound for LJ MD over a fixed window.
- ☑ `tests/validation/test_ising_2d_critical_temperature.py` — magnetization vs. T crosses zero near the analytic critical temperature within tolerance.

Bug-check carry-over:
- *Silently inventing missing physical coefficients* — every coefficient in every module YAML carries a `source` field. Placeholder values are tagged `placeholder: true` and produce a warning at module load.
- *Replacing validated solver calls with naive generated loops* — the 0D rate-equation, MD integrator, and Ising sampler all wrap a vetted scientific Python implementation (scipy / explicit Verlet from a textbook formula / Metropolis with a fixed seed).

#### Workstream 1E — Visualization and Diagnostics — ☑ Closed 2026-05-02

Plan §Phase 1 / Workstream 1E tasks: line plots, heatmaps, particle scatter plots, statistics tables, live diagnostic streaming. Deliverables: basic plotting system, diagnostics API.

Per-entity assertions:

- ☑ `packages/core/src/simworkbench/diagnostics/__init__.py` — package entrypoint exporting the Diagnostics API.
- ☑ `packages/core/src/simworkbench/diagnostics/api.py` — `DiagnosticCollector` / `Diagnostic` types, registration, querying.
- ☑ `packages/core/src/simworkbench/diagnostics/statistics.py` — statistics tables (means, variances, extrema, histograms, conservation-error metrics per plan §12.2).
- ☑ `packages/core/src/simworkbench/diagnostics/streams.py` — live diagnostic streaming (generator / async iterator interface).
- ☑ `packages/core/src/simworkbench/diagnostics/plotters/__init__.py` — plotter package entrypoint.
- ☑ `packages/core/src/simworkbench/diagnostics/plotters/line.py` — line plot.
- ☑ `packages/core/src/simworkbench/diagnostics/plotters/heatmap.py` — heatmap.
- ☑ `packages/core/src/simworkbench/diagnostics/plotters/particle_scatter.py` — particle scatter / phase-space.
- ☑ `tests/unit/test_diagnostics_api.py` — collector contract and registration.
- ☑ `tests/unit/test_diagnostics_statistics.py` — known-mean / known-variance / known-conservation-error sanity cases.
- ☑ `tests/unit/test_plotters.py` — plotter smoke tests (figures produced, axis labels include units, no NaN/Inf in output).
- ☑ `tests/integration/test_diagnostics_streaming.py` — streaming during a 1C runtime run.
- ☑ `packages/core/pyproject.toml` gains a `matplotlib` dependency (plot backend; minimal-display-friendly so headless CI works).

Plot-quality rule (carries into 1E from plan §12.3): plots created for steering a simulation are not necessarily publication-quality. Plotters in 1E target the **steering** lane; the **publication** lane is a follow-up.

#### Workstream 1F — UI Workbench — ☑ Closed 2026-05-02

Plan §Phase 1 / Workstream 1F tasks: build TypeScript UI shell, simulation list, run controls, code viewer, docs viewer, diagnostics panel, plot panel, capsule explorer. Deliverables: usable local UI; program documentation accessible inside the UI.

1F is the only Phase 1 workstream that **consumes** the others — it talks to 1A's types over an HTTP API, drives 1C's runtime, displays 1D's modules, and renders 1E's diagnostics. Implementation order (recommended): land ADR-0005 (UI framework) → backend HTTP API → app shell → per-panel components.

Per-entity TODO assertions tracked while this workstream is open:

- ☑ `program_development/architectural_decisions/ADR-0005-ui-framework.md` — UI framework decision (recommendation: Vite + React to match `docs_site/`, but the ADR records the alternatives and the choice). Status moves `Proposed → Accepted` in the same commit that lands the framework deps in `apps/workbench-ui/package.json`.
- ☑ `packages/core/src/simworkbench/api/__init__.py` — backend HTTP API package entrypoint.
- ☑ `packages/core/src/simworkbench/api/server.py` — HTTP server (FastAPI or equivalent) exposing the experiment / runtime / diagnostics surface the UI needs. Lives under `packages/core/.../api/` per AGENTS.md "Repository Architecture Rules → Packaging boundary".
- ☑ `tests/integration/test_api_server.py` — end-to-end smoke: start server, list experiments, run, retrieve diagnostics.
- ☑ `apps/workbench-ui/index.html` — Vite HTML root.
- ☑ `apps/workbench-ui/vite.config.ts` — Vite config (path aliases for `docs_site/src/content/`, dev server port matching `configs/default.yaml` ui.port=5173).
- ☑ `apps/workbench-ui/src/main.tsx` — Vite entry; mounts `App.tsx` to `#root`.
- ☑ `apps/workbench-ui/src/App.tsx` — top-level shell: layout, router, provides API client context.
- ☑ `apps/workbench-ui/src/components/SimulationList.tsx` — lists simulations from the backend API.
- ☑ `apps/workbench-ui/src/components/RunControls.tsx` — start/pause/resume/stop/checkpoint buttons; subscribes to 1C progress stream.
- ☑ `apps/workbench-ui/src/components/CodeViewer.tsx` — read-only viewer of the active experiment's source. **Reads `<capsule>/src/generated/` and `<capsule>/src/user_edits/` separately and never offers UI affordances that would write back to `user_edits/`** — honors `agent_error_patterns.md` "Overwriting `<capsule>/src/user_edits/` during regeneration".
- ☑ `apps/workbench-ui/src/components/DocsViewer.tsx` — in-app documentation. **Loads from `docs_site/src/content/*.tsx` (the canonical source) — does NOT duplicate doc strings** per AGENTS.md rule 2.
- ☑ `apps/workbench-ui/src/components/DiagnosticsPanel.tsx` — table of registered diagnostics (1E API).
- ☑ `apps/workbench-ui/src/components/PlotPanel.tsx` — renders 1E plotters (line / heatmap / particle scatter). Plot-quality rule applies: this is the steering lane, not publication.
- ☑ `apps/workbench-ui/src/components/CapsuleExplorer.tsx` — directory-form capsule explorer reading `simulation_capsules/<name>.lxp/`. Phase 1F renders the directory layout; full manifest validation lands in Phase 2.
- ☑ `apps/workbench-ui/src/api/client.ts` — typed HTTP client wrapping the backend API. Single source of types — UI components import the request/response types from here.
- ☑ `apps/workbench-ui/src/__tests__/App.test.tsx` — smoke render.
- ☑ `apps/workbench-ui/src/__tests__/SimulationList.test.tsx` — renders mocked simulations.
- ☑ `apps/workbench-ui/src/__tests__/RunControls.test.tsx` — emits start/pause/resume/stop events through the API client.
- ☑ `apps/workbench-ui/src/__tests__/DocsViewer.test.tsx` — verifies the canonical `docs_site/src/content/*.tsx` pages load (no duplication).
- ☑ `apps/workbench-ui/package.json` — real dependencies (React, Vite, Vitest, @testing-library/react, plus the chosen routing library); the Phase-0 placeholder language is removed.
- ☑ `scripts/dev/run_ui.sh` — real implementation: `npm --prefix apps/workbench-ui run dev`. The Phase-0 stub language is removed.
- ☑ `scripts/build/ui.sh` — real implementation: `npm --prefix apps/workbench-ui run build`. The Phase-0 stub language is removed.
- ☑ `docs_site/src/content/usage.tsx`, `docs_site/src/content/architecture.tsx`, and `docs_site/src/content/troubleshooting.tsx` — Phase-1F banner replaced when UI is functional; usage adds the in-app workflow walkthrough.

Bug-check carry-over from `bugs_and_fixes/agent_error_patterns.md`:
- *Overwriting `<capsule>/src/user_edits/` during regeneration* — CodeViewer is read-only for `user_edits/`; any future "edit" affordance writes only to `src/generated/`.
- *Documented path that does not exist as an executable on disk* — when `scripts/dev/run_ui.sh` and `scripts/build/ui.sh` flip from stub to real, the docs that reference them remain accurate; if a path is removed, the docs are removed in the same commit.
- *Aspirational documentation — status drift across README, milestone, and timeline* — the moment the UI is usable end-to-end, all four `docs_site/src/content/*.tsx` pages with Phase-1 banners need updating in one commit.
- *Per-app and per-package `build/` outputs were not gitignored* (logged 2026-05-02 during this open) — `apps/*/build/` is now ignored. Verify with `git check-ignore -v apps/workbench-ui/build/foo.js` after any UI build-tool change.

Add more as workstreams evolve.

### Status sync at close

Flip the status to `Complete` only in a single commit that touches every place it is mirrored: this milestone (Status header + Phase Gate boxes), `README.md` Current Development Status table, `program_development/timeline.md`, any new ADR Status field, any `module.yaml` lifecycle field that transitioned, and any `docs_site/src/content/*.tsx` page that named "Phase 1 — pending" anywhere. Before the flip, the default checker must pass and `--include-open-workstreams` must have no Phase 1 TODOs remaining.

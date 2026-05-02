# Implementation Timeline

Chronological log of major implementation work. Most recent entry first.

---

## Template

```markdown
## YYYY-MM-DD

### Completed
- Bullet list of finished work.

### Changed
- Notable changes to existing systems.

### Open questions
- Decisions deferred to a future date / ADR.

### Next steps
- Concrete near-term work items.
```

---

## 2026-05-02 (Phase 1 — open-workstream checker mode correction)

### Completed
- **Convention checker mode split.** `scripts/dev/check_repo_conventions.sh` default mode now checks hard repository invariants and completed deliverables only, so `./scripts/test/all.sh` remains runnable while 1C/1D/1E are open. The intentional implementation backlog is opt-in via `./scripts/dev/check_repo_conventions.sh --include-open-workstreams`.
- **Corrected 1C TODO coverage.** Added missing backlog assertions for `tests/unit/test_runtime_progress.py` and for `scripts/dev/run_backend.sh` no longer being the Phase-0 stub. The shared `examples/simple_rate_equations/run.py` assertion is tracked once for 1C/1D to avoid duplicate failures for the same file.
- **Corrected 1D TODO coverage.** Added missing module-template assertions for `packages/physics_modules/templates/module_template/src/__init__.py` and `packages/physics_modules/templates/module_template/tests/test_template.py`.
- **Regression guard.** Added `tests/regression/test_convention_checker_modes.py` so the default checker must pass while opt-in open-workstream mode exposes the current Phase 1 backlog (`60 failure(s), 142 check(s) ok`).
- **Agent instructions.** Updated `AGENTS.md` and `CLAUDE.md` to require default checker green, keep intentionally failing TODO assertions opt-in, and prevent `scripts/test/all.sh` from depending on open-workstream backlog mode.

### Open questions
- None. The remaining 60 opt-in failures are the explicit 1C/1D/1E implementation backlog, not hard-gate failures.

### Next steps
- Implement Workstream 1C first. As each workstream closes, promote its completed assertions into the default hard gate and update this milestone/status set in one commit.

---

## 2026-05-02 (Phase 1 — Workstreams 1C, 1D, 1E opened in parallel)

### Completed
- **Bug-checks before opening.** Ran the three code-craft greps (`bugs_and_fixes/agent_error_patterns.md`): residual `data = dict(MINIMAL_SPEC)` at `tests/unit/test_modelspec.py:67` was missed in the linter sweep — fixed in this commit. No `global` declarations and no module-level mutable singletons in `packages/core/src/`. Bug-memory greps surfaced three patterns directly relevant to the new workstreams: *naive solver loops* (1C runtime + 1D rate-equation), *fabricated coefficients* (1D modules), *writing artifacts outside project dir* (1C checkpoints). Each carries forward into the milestone's per-workstream Pre-gate carry-over notes.
- **Workstream 1C — Simulation Runtime — opened.** Plan §Phase 1 / Workstream 1C tasks (start/stop/pause/resume, checkpointing, deterministic seeds, event/log, progress) were initially translated into 16 per-entity convention-checker assertions. The 2026-05-02 checker-mode correction above added the missing progress-test assertion and explicit non-stub backend assertion.
- **Workstream 1D — Basic Physics Modules — opened.** Plan §Phase 1 / Workstream 1D modules were initially translated into 30 per-entity assertions: a module template, seven physics modules (laser/gaussian_pulse, species/basic, species/rate_equation_0d, laser/simple_absorption, laser/simple_emission, molecular_dynamics/lennard_jones, phase_transition/ising_2d), runnable examples, and validation tests. The 2026-05-02 checker-mode correction above added the missing template source/test assertions and clarified the shared rate-equation example assertion.
- **Workstream 1E — Visualization and Diagnostics — opened.** Plan §Phase 1 / Workstream 1E translated into 13 per-entity assertions: `simworkbench.diagnostics.{__init__,api,statistics,streams}`, three plotters (line, heatmap, particle scatter), four tests, and a `matplotlib` dependency in `pyproject.toml`.
- **Convention checker.** At the opening commit it reported `56 failure(s), 142 check(s) ok`. The checker-mode correction above supersedes that state: default mode now passes, and opt-in open-workstream mode reports the corrected `60 failure(s), 142 check(s) ok` backlog.
- **Phase 1 milestone Pre-gate verification.** Restructured by workstream (1A done, 1B done, 1C/1D/1E open, 1F pending) so each workstream lists its plan-named entities verbatim and points back to the bug-memory patterns it must honor.

### Open questions
- Whether `packages/visualization/` should become a separate Python package or stay as `simworkbench.diagnostics.plotters` (currently the latter — defer to ADR if a separation reason emerges).
- Module template detail: how many of the AGENTS.md "Module SDK" files (`assumptions.md`, `validity_domain.md`, `equations.md`, `changelog.md`) are mandatory vs. recommended at `candidate` status. Will resolve with the first module that lands.

### Next steps
- Implement Workstream 1C → 1D → 1E in that order. 1C unlocks the runtime that 1D modules drive; 1D produces the data 1E displays. The convention-checker assertions are the implementation backlog.
- After 1E, evaluate whether 1F (UI workbench) is best landed inside Phase 1 or after Phase 2 (capsule format) so the UI's capsule explorer has a stable format target.

---

## 2026-05-02 (Phase 1A/1B safeguard hardening)

### Completed
- **Three new agent_error_patterns** logged in `bugs_and_fixes/agent_error_patterns.md` distilling the Phase 1A/1B correction sweep:
  - *Implementing the agent's checklist instead of the plan's deliverable list* — the meta-pattern behind the Phase 1A under-scope. Milestone Pre-gate hints are illustrative, never substitutive; the plan's `§Phase N → Workstream NX` description is the deliverable list.
  - *Shallow-copying a mutable test fixture before mutating it* — `dict(FIXTURE)` shares nested lists/dicts; tests must use `copy.deepcopy` or fixture factories.
  - *Module-level mutable state for cached singletons* — `global _REGISTRY` patterns leak state across tests; prefer `@functools.lru_cache(maxsize=1)`.
- **AGENTS.md** — added rule 14 ("plan workstream description = deliverable list"), tightened the Phase Gate Discipline with a new "When starting a workstream" subsection requiring per-named-entity convention-checker assertions, added Required Testing Practices items for deepcopy-fixtures and venv-aware test wrappers, added Code Style items for flexible-dict validation and lru_cache singletons, extended Definition of Done with workstream-completion item.
- **CLAUDE.md** — mirrored AGENTS.md additions as rules 14–17, added a "Starting a workstream" operational subsection with concrete `awk`/`grep` commands for plan enumeration, added a "Code-craft anti-patterns to grep before commit" subsection with executable checks for the three patterns, updated Phase-Specific Operational Notes to reflect the 12-pattern bug-memory state and 142-check convention-checker baseline.
- Convention checker stays at 142/142; the safeguards are textual and procedural, not new assertions. All 68 unit tests still pass.

### Next steps
- Workstream 1C — Simulation runtime, opening with the new Pre-gate procedure: enumerate every plan-named entity from `§Phase 1 → Workstream 1C` before any code lands.

---

## 2026-05-02 (Phase 1 — Workstreams 1A and 1B implementations)

### Completed
- **Workstream 1A completion correction.** Added `simworkbench.experiment` (`Experiment`, `RunConfig`, `DiagnosticConfig`, `BackendConfig`) and `simworkbench.serialization` experiment YAML save/load so Workstream 1A now covers the full plan-defined core experiment model instead of only the ModelSpec slice. Added unit and integration tests for experiment construction and save/load.
- **Workstream 1B boundary hardening.** Closed ModelSpec unit-validation holes in flexible parameter dictionaries: raw numbers and numeric strings are rejected in `fields.initialization`, `interactions.valid_regime`, and unit-typed `domain_bounds`. Added validators for missing species, unknown equation refs, missing coefficient sources, unsupported backend compatibility, unknown validity-regime keys, and missing spatial bounds/boundary conditions.
- **Test-wrapper environment fix.** `scripts/test/{unit,integration,regression,validation,performance}.sh` now prefer `.venv/bin/python` when present, avoiding ambient-Python import failures after dependencies are installed in the repo virtualenv.
- **Workstream 1B — Units subsystem.** `simworkbench.units` lands, wrapping `pint` per ADR-0004. Public API: `Q`, `parse_quantity`, `to_unit`, `magnitude`, `check_dimensionality`, `require_units`, `require_dimensionality`, `equations_consistent`, `UnitsError`. Workbench `pint.UnitRegistry` includes laser-physics-friendly aliases (`photon_energy`, `number_density`, `intensity`) and probes the unit strings every Phase 1+ ModelSpec will use at registry-build time so missing definitions fail loudly. 30 unit tests pass.
- **Workstream 1A — ModelSpec IR.** `simworkbench.model_spec` lands, implementing the Pydantic-v2 typed schema from ADR-0003 / plan §8.1. Custom `Quantity` field type rejects raw floats at the boundary (plan §22) and round-trips through YAML. Cross-section validators per plan §8.2 catch unknown interaction participants, unknown diagnostic quantities, 0D-with-boundary-conditions, and `units_checked=True` without assumptions. JSON-Schema export available via `get_json_schema()`. Example ModelSpec at `examples/simple_rate_equations/model.yaml` loads, validates, and round-trips cleanly. 20 ModelSpec tests pass.
- **Convention checker.** Extended from 117 to 142 checks. New assertions cover `simworkbench/units/{__init__,registry,quantity,validators}.py`, `simworkbench/model_spec/{__init__,types,loader,schema}.py`, `simworkbench/experiment/{__init__,types}.py`, `simworkbench/serialization/{__init__,experiment}.py`, `examples/simple_rate_equations/model.yaml`, `tests/unit/test_{modelspec,units,experiment}.py`, `tests/integration/test_experiment_save_load.py`, test-wrapper virtualenv usage, and pyproject deps on pint/pydantic/pyyaml.
- **`packages/core` packaging.** `pyproject.toml` bumped to 0.1.0 with real dependencies (pint, pydantic, pyyaml, numpy) and dev deps (pytest, pytest-cov, ruff). `scripts/dev/install.sh` already creates `.venv`, installs core editable, and brings up the Node workspaces — installing the now-real Python deps as a side effect.

### Open questions
- ModelSpec migration strategy for schema_version bumps (deferred to ADR-0005 when v0.2 actually arrives).
- Whether to add `pint` <-> `numpy.ndarray` conversion helpers at the `simworkbench.units` boundary now or in Phase 8 when the GPU/HPC backends arrive (deferred — wrapper has the hooks).

### Next steps
- Workstream 1C — Simulation runtime: start / pause / resume / checkpoint API in `simworkbench.runtime.runner`. First consumer: a 0D rate-equation runner that drives `examples/simple_rate_equations/model.yaml` end-to-end.
- Workstream 1D — Basic physics modules: Gaussian laser pulse, basic species, 0D rate-equation solver wrapping `scipy.integrate.solve_ivp`.
- Workstream 1E — Visualization and diagnostics.
- Workstream 1F — UI workbench (deferred until 1C/1D land so the UI has something to display).

---

## 2026-05-02 (Phase 1 opens)

### Completed
- **Phase 1 opens.** Status flipped from `Not started` → `In progress` across `README.md` (Current Development Status table), `program_development/milestones/phase_01_manual_workbench.md` (Status header), and this timeline. Active workstreams: 1A (Core Experiment Model — ModelSpec) and 1B (Units and Quantities). Workstreams 1C–1F remain pending.
- **ADR-0004 — Units library = `pint`.** Accepted. Resolves the Phase 0 carry-over decision. The library is wrapped behind `simworkbench.units` so the public API is workbench-defined and `pint` is a swappable implementation detail. `configs/default.yaml` updated from `units.library: pending` to `units.library: pint`.

### Open questions
- UI framework choice for `apps/workbench-ui` (deferred to Workstream 1F kickoff).
- Whether the `simworkbench.units` wrapper should also expose a NumPy-array-flavored quantity for HPC backends in Phase 8 (deferred to Workstream 1B implementation).

### Next steps
- Workstream 1B implementation: pint wrapper, workbench unit registry, dimensional validators, tests.
- Workstream 1A implementation: Pydantic-based ModelSpec types, YAML loader, JSON Schema export, tests, first example ModelSpec under `examples/simple_rate_equations/`.

---

## 2026-05-02

### Completed
- **Safeguards against the Phase 0 gate-correction bugs.** Added three new error patterns to `bugs_and_fixes/agent_error_patterns.md` (documented-path-must-exist, status-drift across README/milestone/timeline, plan-as-check vs. plan-as-draft). Added a `Phase Gate Discipline` section to `AGENTS.md` and a parallel operational `Phase Gate Procedure` to `CLAUDE.md` covering: deliverables-to-checker translation when a phase opens, status-sync-in-one-commit when a phase closes, reality-testing of plan-derived patterns, and stub-script policy for documented commands. Added a `Pre-gate verification` section with phase-specific deliverable hints to `program_development/milestones/phase_01..phase_10`. Convention checker still passes 116/116; the safeguards are textual and procedural, not new assertions.
- **Phase 0 gate correction.** Added missing plan-required package skeleton files (`apps/workbench-ui/package.json`, `apps/workbench-ui/tsconfig.json`, `packages/core/pyproject.toml`, `packages/core/src/simworkbench/__init__.py`) and concrete wrapper scripts for the README-documented commands under `scripts/dev/`, `scripts/docs/`, `scripts/build/`, `scripts/test/`, and `scripts/export/`.
- **Milestone filename correction.** Replaced stale Phase 2-5 milestone filenames with plan-matching names and added Phase 6-10 milestone stubs so `program_development/milestones/` now covers Phase 0 through Phase 10.
- **Convention checker expansion.** Extended `scripts/dev/check_repo_conventions.sh` from 90 to 116 checks, covering package manifests, executable command wrappers, `tests/README.md`, and all plan-matching milestone files.
- **Phase 0 / Workstream 0A — Repository Skeleton.** Created root governance files (`AGENTS.md`, `CLAUDE.md`, `README.md`) and the project-wide `.gitignore` per plan §3.2. Built the directory skeleton from plan §3 with `.gitkeep` markers in every empty directory. Added example configs: `configs/default.yaml`, `configs/local.yaml.example`, `configs/backends.yaml`, `configs/agents.yaml`.
- **Phase 0 / Workstream 0B — Documentation Site.** Vite + React + React Router skeleton at `docs_site/` with `package.json`, `tsconfig.json`, `vite.config.ts`, layout/sidebar components, and the ten required content pages from plan §4.2 (`overview`, `installation`, `usage`, `architecture`, `module_development`, `internal_tools`, `simulation_capsules`, `agent_workflows`, `validation`, `troubleshooting`). Each page is a self-contained TSX component with a Phase-0-skeleton banner and a "what this page should cover when expanded" checklist for future phases.
- **Phase 0 / Workstream 0C — Bugs and Fixes.** Created `bugs_and_fixes/{README.md, bugfixes.md, known_failures.md, regression_tests.md, agent_error_patterns.md, program.log.example}`. Pre-populated `agent_error_patterns.md` with six guardrail patterns derived from plan §22 / §16.3 plus the `build/` gitignore-collision pattern caught during this phase.
- **Phase 0 / Workstream 0D — Development History.** Created `program_development/{README.md, timeline.md, architectural_decisions/{_template.md, ADR-0001..0003}, milestones/phase_00..phase_10}`. ADR-0001 (project scope) and ADR-0003 (ModelSpec IR) are Accepted; ADR-0002 (capsule format) is Proposed pending HDF5-vs-Zarr lock-in in Phase 2.
- **Convention checker** at `scripts/dev/check_repo_conventions.sh`: 116 checks covering root files, gitignore entries, local-only directories, package manifests, executable script wrappers, tests/scripts/examples/configs, bug-memory files, dev-history files, docs-site pages, gitignore-collision regression, and forbidden tracked artifacts. Exits non-zero on failure. Phase 0 gate passed.

### Changed
- Replaced the bootstrap-default Next.js `.gitignore` with the workbench-specific `.gitignore` from plan §3.2, then immediately patched it: changed bare `build/` to `/build/` after discovering it silently ignored `scripts/build/`. See `bugs_and_fixes/bugfixes.md` 2026-05-02.
- Updated `README.md`, `docs_site/README.md`, and relevant docs pages to describe the Phase 0 command wrappers and corrected Phase 0 completion status.

### Open questions
- Default capsule data format: HDF5 vs. Zarr (deferred to ADR-0002 finalization in Phase 2).
- Units library: pint vs. astropy.units vs. custom wrapper (deferred to Phase 1B).
- UI framework choice for `apps/workbench-ui` (likely Next.js or Vite + React, decision in Phase 1F).

### Next steps
- **Phase 0 gate: PASSED.** Convention checker green; all four workstreams complete; bugfix log seeded with the first real entry.
- Phase 1 / Workstream 1A: define `ModelSpec` schema v0.1 (`packages/core/src/simworkbench/model_spec/`). Driven by ADR-0003.
- Phase 1 / Workstream 1B: pick units library, write the units subsystem ADR.
- Phase 1 / Workstream 1C: stub the simulation runtime API (start/pause/resume/checkpoint).
- Begin Phase 1 milestone file with active workstream tracking.

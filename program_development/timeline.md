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

## 2026-05-02 (Phase 2 closes — Simulation Capsule System complete)

### Completed
- **Workstream 2A — Capsule Format & Validator — shipped.** ADR-0002 ratified `Accepted` with HDF5 lock-in. Pydantic `Manifest` with `[capsule] [paper] [model] [runtime] [provenance]` sections at schema `v0.1`. `CapsuleValidator` returns a structured `ValidationReport` with severity-stratified violations. HDF5 `bulk_data.write_diagnostics_h5` with gzip-3 compression, JSON kept as a fallback. Migration registry with identity v0.1→v0.1 step. 207→239 default-checker entities; 207→260 tests after 2A unit/integration suites.
- **Workstream 2B — Provenance System — shipped.** `ProvenanceLock` (TOML) captures workbench/Python/platform versions, run_id, base_seed, backend, ModelSpec hash, source-file hashes, format version, parent capsule hash, placeholders. `capture_environment()` writes `environment.yaml` with pip freeze + system info. `AgentTraceWriter` is append-only and refuses any record naming `<capsule>/src/user_edits/` (carries `agent_error_patterns.md` "Overwriting `<capsule>/src/user_edits/` during regeneration" into the writer's contract). `SourceRegistry` SHA-256-hashes `paper_sources/`, `src/generated/`, `src/user_edits/` with an aggregate-hash collapse for capsule identity.
- **Workstream 2C — Export System — shipped.** Six exporters (code/data/plots/notebook/report/archive) behind `export_capsule()`; every exporter validates `is_under_workbench()` BEFORE side-effecting (carries `agent_error_patterns.md` "Side-effecting before validating"). `fork_capsule()` copies every subtree except `provenance/`, computes parent's source-aggregate hash, and writes a fresh provenance lock + `agent_trace.md` + `environment.yaml`. Real shell wrappers under `scripts/export/{capsule,fork_capsule}.sh` replace the Phase-0 stubs. New regression test `tests/regression/test_user_edits_not_overwritten.py` locks the user_edits invariant across fork + export + re-fork.
- **Workstream 2D — Capsule UI — shipped.** Six React components (`ManifestView`, `ModelSpecView`, `CapsuleCodeView`, `ResultsView`, `ValidationView`, `ProvenanceView`) under `apps/workbench-ui/src/components/capsule/`. `CapsuleExplorer.tsx` expanded into a tabbed detail panel that drills into a selected capsule. Four new backend endpoints (`GET /api/capsules/{name}`, `/files/{path:path}`, `/validate`, `/diagnostics`) — every one validates the resolved path is inside `simulation_capsules/` BEFORE any read (path-escape `..` returns 400/404). `CapsuleCodeView` renders a "user-owned — agents must not overwrite" badge on `src/user_edits/` so the long-standing pattern is visible in the UI as well as the writer.
- **Status flip.** README, CLAUDE.md, milestone, timeline, and `docs_site/src/content/simulation_capsules.tsx` all flipped in this commit. Milestone checkboxes flipped from `☐` to `☑`; workstream subheaders flipped from "Open" to "Closed".
- **Convention checker ratchet.** All Phase 2A/2B/2C/2D entity assertions promoted from the `--include-open-workstreams` opt-in branch into the default hard gate (per `agent_error_patterns.md` "Closing a workstream without promoting its assertions from opt-in to default"). Default mode now 290/290 ok; opt-in mode passes with the "no open workstreams — Phase 3 not yet opened" message. Regression test `tests/regression/test_convention_checker_modes.py` flipped to its closed-phase form.
- **Bug check.** 311 Python tests pass, 11 UI vitest tests pass, ruff clean (added `PLR0915` to the ignore list — large FastAPI factory functions register many routes in a single closure, which is intended; matches the existing rationale for `PLR0913`).
- **App.test.tsx** fixed for a pre-existing failure: `screen.getByText("Simulations")` matched both the sidebar nav `<a>` and the page `<h2>`. Test now scopes to `getByRole("navigation")` then `within(nav).getByText(label)`.

### Open questions
- None Phase-2-blocking. Phase 3 opens next per plan §Phase 3.

### Next steps
- Open Phase 3 per plan §Phase 3 using the existing milestone Pre-gate template. First action: enumerate plan §Phase 3 deliverables and add per-entity opt-in convention-checker assertions, mirroring the procedure that worked for Phases 1 and 2.

---

## 2026-05-02 (Phase 2 opens — Simulation Capsule System)

### Completed
- **Bug-checks before opening.** Default + opt-in convention checker green (239/239), 207 tests pass, ruff clean. Code-craft greps clean (no shallow-copied fixtures, no module-mutable singletons, no `global` declarations in `packages/core/src/`). Bug-memory grep against `capsule | provenance | export | archive | manifest | hdf5 | zarr | fork` surfaces three patterns to carry forward into Phase 2: *Overwriting `<capsule>/src/user_edits/` during regeneration* (carries into 2C export and 2D capsule UI), *Writing program artifacts outside the project directory* (carries into 2C export tooling), *Treating the plan document as a check instead of as a draft* (carries into 2A — the manifest schema is reality-tested against the Phase 1 minimal capsule before any rename).
- **Workstream 2A — Capsule Format & Validator — opened.** Plan §Phase 2 / 2A translated into 12 per-entity opt-in convention-checker assertions covering ADR-0002 transition (Proposed → Accepted with HDF5 chosen), `simworkbench.serialization.{manifest, validator, bulk_data}`, `simworkbench.serialization.migrations.{__init__, v0_1}`, `h5py` dep, and four unit/integration tests.
- **Workstream 2B — Provenance System — opened.** Plan §Phase 2 / 2B translated into 9 assertions covering `simworkbench.provenance.{__init__, lock, environment, agent_trace, sources}` and four unit tests.
- **Workstream 2C — Export System — opened.** Plan §Phase 2 / 2C translated into 19 assertions covering `simworkbench.serialization.{export, exporters/{code,data,plots,notebook,report,archive}, fork}`, real `scripts/export/{capsule,fork_capsule}.sh`, six unit tests, two integration tests, and a regression test for the `user_edits/` invariant.
- **Workstream 2D — Capsule UI — opened.** Plan §Phase 2 / 2D translated into 9 assertions covering six new `apps/workbench-ui/src/components/capsule/*View.tsx` components, the existing CapsuleExplorer Vitest test, and two new backend API routes (`/api/capsules/{name}` + `/validate`).
- **Phase 2 milestone Pre-gate verification** restructured by workstream with full plan-named entity enumeration (~50 entities total). Bug-check carry-over notes per workstream cite the relevant `agent_error_patterns.md` patterns. Recommended decisions for the two pending choices: **HDF5** for the bulk-data format (Zarr revisited in Phase 8 if HPC parallel-write parity becomes the constraint); **TOML** for `provenance.lock` (matching the Phase 1 minimal capsule's existing format).
- **Status flip.** Phase 2 row in README → "In progress (2A, 2B, 2C, 2D open)". Milestone status header → "In progress (opened 2026-05-02). All four workstreams 2A, 2B, 2C, 2D open."
- **Convention checker.** Default mode unchanged at 239/239 ok. Opt-in mode now reports the Phase 2 TODO backlog with ~50 failing assertions — the explicit deliverable list per `agent_error_patterns.md` "Implementing the agent's checklist instead of the plan's deliverable list".

### Open questions
- ADR-0002: HDF5 vs Zarr — **recommended HDF5**, ratification lands in the 2A implementation commit that creates `bulk_data.py`.
- `provenance.lock` format: JSON vs TOML — **recommended TOML** (matches Phase 1 minimal capsule's existing serializer).
- Whether `fork_capsule()` should also fork `provenance/` (read-only copy with parent-hash chain) or omit it entirely (Phase 1 minimal capsule treats provenance as append-only). Decision lands in the 2C `fork.py` commit.

### Next steps
- Implement 2A first (the schema + validator + bulk_data unblock 2B/2C). 2B and 2D can land in parallel after 2A.
- Each workstream closes by promoting its assertions out of `--include-open-workstreams` into the default branch, per the lesson from `bugs_and_fixes/bugfixes.md` *Phase 1 false close*.

---

## 2026-05-02 (Phase 1 — REAL CLOSE after review-fix sweep)

### Completed
- All seven review-finding issues from the earlier "Phase 1 false close" are fixed and landed:
  1. **Capsule save/reload** — `simworkbench.serialization.capsule` ships a minimal `.lxp/` directory format. 6 round-trip tests pass. Phase Gate items 4 and 5 now genuinely green.
  2. **Opt-in → default ratchet** — every 1C/1D/1E/1F entity assertion moved out of `--include-open-workstreams` into the default branch. Default checker now reports 245 ok (up from 148) and asserts every Phase 1 deliverable. Opt-in mode still runs but reports no failures.
  3. **Checkpoint guard order** — `simworkbench.runtime.checkpoint.checkpoint_dir()` now validates `is_under_workbench()` BEFORE any `mkdir`. Strengthened regression tests assert the rejected directory is NOT created on disk (not just that the exception is raised).
  4. **Placeholder coefficient surfacing + non-fabrication** — `python_cpu` backend refuses interactions with empty `coefficient_sources` AND interactions whose sources don't begin with `"placeholder:"` (Phase 1 has no rate-parser, so an unsourced rate is silent fabrication per plan §22). `RunResult.placeholders`, `RunSummary.placeholders` + `placeholder_used`, and the UI's SimulationList "Validation" column all propagate the flag through to the user.
  5. **API factory state isolation** — `_RUNS` removed from module scope; the runs registry now lives in the `create_app()` closure. New `test_two_apps_have_isolated_run_registries` asserts a fresh app has no cross-contamination.
  6. **Status sync** — CLAUDE.md "Phase-Specific Operational Notes" updated; milestone per-workstream sub-sections all ticked from `☐ Open` to `☑ Closed`.
  7. **Ruff clean** — 28 violations → 0. Top-level `ruff.toml` covers everything ruff lints from the repo root. `scripts/test/lint.sh` is wired into `scripts/test/all.sh` so future "tests pass" claims include lint.
- **Real Phase 1 close** flips status to "Complete" across `README.md`, `program_development/milestones/phase_01_manual_workbench.md`, `program_development/timeline.md` (this entry), `CLAUDE.md` "Phase-Specific Operational Notes", `docs_site/src/content/overview.tsx`. Default convention checker is the source of truth: it now passes against every Phase 1 plan-named deliverable.
- Six new error patterns logged in `bugs_and_fixes/agent_error_patterns.md` from the Phase 1 false-close review (each fix above lands with its named pattern).

### Final Phase 1 metrics (this commit)
- Default convention checker: **239 / 239** passing (was 148 — opt-in entries promoted in, plus capsule-API and lint-enforcement assertions added by the review fixes).
- Opt-in convention checker: **0 failures**, no Phase 1 backlog remaining.
- Tests: **207** unit / integration / regression / validation passing.
- Ruff: **0 violations** across `packages/core/src/`, `packages/physics_modules/`, `tests/`.
- Workstreams: 1A ☑ 1B ☑ 1C ☑ 1D ☑ 1E ☑ 1F ☑.
- Phase Gate items: 1 ☑ 2 ☑ 3 ☑ 4 ☑ 5 ☑ 6 ☑ 7 ☑ 8 ☑.

### Next steps
- Phase 2 (Simulation Capsule System) opens with the existing milestone Pre-gate template. Finalize ADR-0002 (HDF5 vs Zarr), full provenance writer, fork/export tooling.

---

## 2026-05-02 (Phase 1 close REOPENED — review identified seven issues)

### Completed
- **User review of the Phase 1 close** identified seven legitimate issues. Logged in `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 1 false close*. Six new patterns added to `agent_error_patterns.md`:
  - *Unilaterally redefining a Phase Gate item during the close* — Phase Gate items 4 and 5 (capsule save/reload) were narrowed to "Phase 2's problem" without ADR authority. Plan wins.
  - *Closing a workstream without promoting its assertions from opt-in to default* — completed deliverables stayed in opt-in mode; default checker never ratcheted up.
  - *Side-effecting before validating* — `checkpoint_dir()` ran `mkdir` before `is_under_workbench()` rejected the path. `/tmp/checkpoints/` was actually being created by the regression tests.
  - *API factory advertises isolation while sharing module-global state* — `_RUNS` at module scope contradicted the `create_app()` "fresh registry" contract.
  - *Status-sync that misses CLAUDE.md and per-workstream subsections* — top-level "Complete" while body sections still said "Open" for 1C/1D/1E/1F.
  - *Skipping the linter the repo rules require* — 28 ruff violations shipped uncaught.
- **Phase 1 status reopened** across `README.md`, `program_development/milestones/phase_01_manual_workbench.md`, and this timeline. The status flip is "Complete → close reopened (review fixes in flight)".

### Next steps (each one its own commit + push)
1. Reorder `checkpoint_dir()` so `is_under_workbench()` fires before `mkdir`. Strengthen regression to assert the directory does NOT exist after refusal.
2. Backend distinguishes placeholder vs sourced rates and refuses unsourced rates without explicit placeholder flag. Surface `placeholder_used` through `RunSummary` and into the UI.
3. Move `_RUNS` into the `create_app()` closure. Add a regression test demonstrating two app instances don't share runs.
4. Run `ruff check`; fix all 28 violations. Add `scripts/test/lint.sh` and wire into `scripts/test/all.sh`.
5. Implement minimal `simworkbench.serialization.capsule` — `save_capsule()` + `load_capsule()` with a real `.lxp/` directory. Roundtrip tests. Phase Gate items 4–5 satisfied.
6. Promote 1C/1D/1E/1F entity assertions out of the `--include-open-workstreams` branch into the default branch. Default checker count rises by ~80 entities.
7. Sync CLAUDE.md "Phase-Specific Operational Notes" + the milestone's per-workstream subsection checkboxes.
8. Real Phase 1 close commit — status flip across every status-bearing file in lockstep. Default checker covers every Phase 1 entity.

---

## 2026-05-02 (Phase 1 — earlier "CLOSED" claim, withdrawn)

### Completed
- **Workstream 1C — Simulation runtime.** `simworkbench.runtime.{Runner, Checkpoint, EventBus, ProgressTracker, SeedSet}` + `simworkbench.paths`. The default `python_cpu` backend wraps `scipy.integrate.solve_ivp` for 0D rate-equation models — never a hand-rolled timestep loop, per `agent_error_patterns.md`. 6 unit tests, 1 integration test (pause/resume identity), 1 regression test (writes-only-to-temp_runs). Real `scripts/dev/run_backend.sh`. End-to-end runnable `examples/simple_rate_equations/run.py`.
- **Workstream 1D — Basic physics modules.** Module template + seven `candidate` modules (`laser/{gaussian_pulse, simple_absorption, simple_emission}`, `species/{basic, rate_equation_0d}`, `molecular_dynamics/lennard_jones`, `phase_transition/ising_2d`). Each has `module.yaml` + `README.md` + `src/__init__.py` + a unit test. Three runnable examples: simple_rate_equations (driven by 1C runtime), molecular_dynamics (LJ MD with energy-drift < 3e-5), ising_phase_transition (sweeps T* across Onsager critical, magnetization 0.97 → 0.26 across 1.5 ≤ T* ≤ 4.0). Three validation tests in `tests/validation/`.
- **Workstream 1E — Diagnostics + plotters.** `simworkbench.diagnostics.{Diagnostic, DiagnosticCollector, DiagnosticStream, summarize, conservation_error, line_plot, heatmap, particle_scatter}`. matplotlib forced to `Agg` so headless CI works. 4 tests: API + statistics + plotters + streaming-during-runtime integration test.
- **Workstream 1F — UI workbench + backend API.** ADR-0005 (Vite + React, accepted) precedes the UI implementation. Backend `simworkbench.api.server` is a small FastAPI app exposing /api/{health, runs, docs/pages, capsules, temp_runs}. UI app at `apps/workbench-ui/` — Vite + React + React Router with seven plan-named panels (SimulationList, RunControls, CodeViewer, DocsViewer, DiagnosticsPanel, PlotPanel, CapsuleExplorer), a typed API client, and four Vitest tests. **DocsViewer loads from `docs_site/src/content/` via the `@docs` Vite alias** — the canonical docs source, no duplication, enforced by a `check_grep_in_file 'docs_site'` assertion. `apps/*/build/` and `packages/*/build/` added to `.gitignore` (caught by the bug-memory grep during the 1F open).
- **Phase 1 close — status flip in one commit.** README, milestone, timeline, and five `docs_site/src/content/*.tsx` pages (overview, installation, architecture, usage, validation) all updated together. Phase Gate criteria 1, 2, 3, 6, 7, 8 are green; criteria 4 (capsule save) and 5 (capsule reload) are explicitly Phase 2 per ADR-0002 — Phase 1A's experiment YAML save/load substitutes for now.

### Open questions
- None Phase-1-blocking. Phase 2 will finalize the `.lxp/` capsule format (HDF5 vs Zarr decision, ADR-0002 transition Proposed → Accepted) and ship the provenance writer.

### Next steps
- Open Phase 2 (Simulation Capsule System) per the existing milestone Pre-gate template. First action: enumerate plan §Phase 2 deliverables and add per-entity opt-in convention-checker assertions, mirroring the procedure that worked for Phase 1.

### Final Phase 1 metrics
- Default convention checker: **148/148** passing.
- Opt-in convention checker: **0 failures, 232 checks** passing — all Phase 1 entities exist on disk.
- Tests: **199** Python unit + integration + regression + validation, all green.
- Workstreams: 1A ☑ 1B ☑ 1C ☑ 1D ☑ 1E ☑ 1F ☑.

---

## 2026-05-02 (Phase 1 — Workstream 1F opened; build-output gitignore gap fixed)

### Completed
- **Bug-check before opening 1F.** Ran the three code-craft greps (clean) and the bug-memory grep against UI/TS/frontend/capsule keywords. The grep surfaced the `apps/workbench-ui/{package,tsconfig}.json` Phase-0-precedent and the "Bare gitignore globs" pattern. Reality-test (`git check-ignore -v apps/workbench-ui/build/foo.js`) confirmed the gap: per-app and per-package `build/` outputs were **not** gitignored. The earlier `build/` → `/build/` fix anchored to root only — the pattern's required behavior calls for `/build/` AND `apps/*/build/` AND `packages/*/build/`. Logged in `bugs_and_fixes/bugfixes.md` 2026-05-02 *Per-app and per-package `build/` outputs were not gitignored*. Fix landed in this commit; default checker now enforces all three tiers.
- **Workstream 1F — UI Workbench — opened.** Plan §Phase 1 / Workstream 1F translated into 22 per-entity opt-in convention-checker assertions covering ADR-0005 (UI framework choice), the backend HTTP API under `simworkbench.api`, the Vite + React app shell (index.html, vite.config.ts, main.tsx, App.tsx), seven plan-named UI components (SimulationList, RunControls, CodeViewer, DocsViewer, DiagnosticsPanel, PlotPanel, CapsuleExplorer), the typed API client, four Vitest tests, real `package.json` (no longer Phase-0 placeholder), real `scripts/dev/run_ui.sh` and `scripts/build/ui.sh` (no longer stubs), and a positive `check_grep_in_file` ensuring `DocsViewer.tsx` loads from the canonical `docs_site/` source rather than duplicating doc strings.
- **Convention checker.** Default mode now reports `148 check(s) ok` (was 142; +6 new build-output-tier regressions). Opt-in mode reports `82 failure(s), 150 check(s) ok` (was `60 failure(s), 142 check(s) ok`; +22 new 1F TODOs).
- **Phase 1 milestone Pre-gate verification.** Added the 1F section with full plan-named entity enumeration and four bug-check carry-over notes (CodeViewer must not write to `user_edits/`; documented stub→real transitions; status sync at the moment the UI becomes usable; per-app `build/` ignore reality-test).
- **Status sync.** README Phase 1 row, milestone Status header, and this timeline now agree: Workstreams 1A and 1B complete; 1C, 1D, 1E, 1F open.

### Open questions
- ADR-0005: UI framework choice. Recommendation pending — Vite + React matches `docs_site/` and reuses the same toolchain, but Next.js gives stronger SSR for the docs viewer if internal docs ever need server-rendered indexing. Decision lands in a small commit when 1F implementation starts.
- Whether the backend HTTP API should be FastAPI or a lighter alternative; deferred to API server commit.

### Next steps
- Implement Workstream 1C first (runtime is the dependency for 1D modules and 1E diagnostics, all of which 1F displays).
- Once 1C is green, 1D and 1E can land in parallel.
- 1F lands last — its components depend on the API surface that 1C/1E define.

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

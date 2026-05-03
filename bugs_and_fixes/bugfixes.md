# Bugfix Log

Each resolved bug is logged here using the template below. Entries are append-only and ordered most-recent-first.

---

## Template (copy when adding a new entry)

```markdown
## YYYY-MM-DD: Short bug title

### Affected subsystem
`packages/<path>/`

### Symptoms
What the user or test observed.

### Root cause
The actual cause, not just the error message.

### Fix
What changed. Reference commit SHA or PR.

### Regression protection
Test path(s) added or updated. Cross-listed in `regression_tests.md`.

### Agent warning
What future agents must not repeat.
```

---

<!-- Append entries below this line, most recent first. -->

## 2026-05-02: Phase 2 false close — six legitimate review findings

### Affected subsystem
Repository-wide. Phase 2 close at commit `d88db3e` claimed Phase 2 complete; user review identified seven outstanding issues spanning capsule reload, `save_capsule`'s use of the Phase 2B writers, `CapsuleValidator`'s required-files list, the exporters' destruct-before-guard ordering, the Capsule UI's code viewer, the diagnostics API JSON fallback, and the source-aggregate hash's subtree set. Plus the README's two-place phase-status string drifted, and the build scripts emitted `.js` files into the source tree.

### Symptoms
1. **Reload was a stub.** `scripts/dev/run_capsule.sh` still printed `Capsule loading is scheduled for Phase 2.` and exited 2. README:239 documents this script as the reload entrypoint, so the Phase 2 gate ("portable, inspectable, **reloadable**, exportable") was unmet.
2. **`save_capsule` ignored the Phase 2B writers.** `provenance.lock` was a hand-rolled minimal dict (didn't validate as `ProvenanceLock` — `load_lock()` raised); `environment.yaml` was never written; `agent_trace.md` was overwritten on each save instead of appended via `AgentTraceWriter`. Phase 2B writers existed and had unit tests, but no producer actually invoked them.
3. **`CapsuleValidator` accepted broken Phase 2 capsules.** `REQUIRED_FILES` listed `results/diagnostics.json` (legacy) but not `results/diagnostics.h5` (Phase 2A canonical), and didn't require `provenance/environment.yaml` (Phase 2B). Deleting `diagnostics.h5` left the validator green.
4. **Exporters destructively `rmtree`d the destination before checking source/target overlap.** `export_capsule(capsule, capsule, kinds=("code",))` deleted `<capsule>/src/generated` before raising. The notebook exporter embedded `Path('/Users/.../capsule.lxp')` as a literal — exports were not portable.
5. **`CapsuleCodeView` never showed any code.** It fetched `src/generated/__index__` from the file endpoint, which only serves files, so the call always returned 404 and the panel stayed empty. The convention checker's existence assertion was satisfied because the component file existed.
6. **`/api/capsules/{name}/diagnostics` JSON fallback returned the wrong shape.** It returned the whole capsule JSON sidecar (`run_id`, `state`, `elapsed_seconds`, `placeholders`, `diagnostics`, ...) as `series`, leaking metadata keys into the UI's series table.
7. **`SourceRegistry.DEFAULT_SUBTREES` didn't include `paper_sources/`.** Editing `paper_sources/paper.txt` did not shift the capsule's identity hash — silent break of the provenance chain after a paper edit.

Plus: README:5 said "Phase 2 complete" while README:33 said "In progress (2A, 2B, 2C, 2D open)"; `scripts/build/ui.sh` and `scripts/docs/build.sh` failed (the former emitted `.js` into `src/`, the latter had no local `tsc`). Vitest was picking up the leaked `.js` test duplicates.

### Root cause
Six new agent failure modes, each now logged in `agent_error_patterns.md`:

- *Convention-checker existence ≠ phase-gate behavior* — issues 1, 5. The checker proved files existed; nobody proved the gate-criterion behaviors worked end-to-end.
- *Building writers without wiring producers* — issue 2. Phase 2B's writers had unit tests; the producer that should have called them did not.
- *Schema drift between writers and validators* — issue 3. Phase 2A made HDF5 canonical; the validator's required list didn't follow.
- *Destructive-before-guard in exporters* — issue 4 (first half).
- *Embedding absolute paths in exported artifacts* — issue 4 (second half).
- *Build script emits compile artifacts into the source tree* — the `.js` leak.
- *Duplicated phase status across nearby paragraphs* — README:5 vs README:33.

Issue 6 (diagnostics API JSON fallback) is a plain wiring bug in the JSON-sidecar-shape contract; issue 7 is a narrow `DEFAULT_SUBTREES` omission. Both were caught by the audit grepping the actual user-facing surface, not the convention checker.

### Fix
A single follow-up commit (this one) addresses all seven:

- `scripts/dev/run_capsule.sh` becomes a real implementation calling `load_capsule` + `Runner`. Smoke test at `tests/integration/test_run_capsule_script.py`.
- `save_capsule` calls `ProvenanceLock` + `write_lock`, `write_environment`, `AgentTraceWriter(...).append(...)`. The hand-rolled `_write_toml`/`_toml_value` helpers are deleted.
- `CapsuleValidator.REQUIRED_FILES` adds `results/diagnostics.h5` and `provenance/environment.yaml`; `RECOMMENDED_FILES` (new) holds `results/diagnostics.json` (warning-only sidecar). Three new validator tests assert the new requirements.
- Exporters validate the entire plan before any `rmtree`. Notebook uses `Path('..') / 'results'` instead of an absolute path. Tests assert the source survives a self-export attempt and that no absolute path appears in the notebook source.
- New `GET /api/capsules/{name}/tree?subtree=<path>` endpoint enumerates files. `CapsuleCodeView` calls it, groups by `src/generated`, `src/user_edits`, `src/kernels`, and lets the user click a file to view it.
- `/api/capsules/{name}/diagnostics` JSON fallback returns `payload["diagnostics"]` (or the payload itself if no `diagnostics` key) — never the whole sidecar.
- `SourceRegistry.DEFAULT_SUBTREES` includes `paper_sources/`. New regression test asserts editing `paper_sources/paper.txt` shifts the aggregate hash.
- README's status-table line flipped to **Complete**; build scripts use `tsc --noEmit && vite build`; tsconfig sets `noEmit: true`; `.gitignore` carries defensive rules for `apps/*/src/**/*.js` and `docs_site/src/**/*.js`.

### Regression protection
Each new pattern has a Detection section. Concrete tests added:
- `tests/integration/test_run_capsule_script.py` exercises the reload script end-to-end and asserts the script is not the Phase-0 stub.
- `tests/unit/test_capsule_validator.py` adds `test_validator_requires_diagnostics_h5`, `test_validator_requires_environment_yaml`, `test_validator_warns_on_missing_diagnostics_json_sidecar`.
- `tests/unit/test_export_code.py::test_export_code_refuses_self_overwrite` and the matching test in `test_export_data.py` assert source-survival after a self-export attempt.
- `tests/unit/test_export_notebook.py::test_notebook_uses_relative_capsule_path` asserts no absolute path leaks into the notebook source.
- `tests/integration/test_api_server.py` adds `test_get_capsule_diagnostics_json_fallback` and `test_get_capsule_tree_lists_src_files`.
- `tests/unit/test_provenance_sources.py::test_paper_sources_in_default_aggregate_hash`.

### Agent warning
A close commit must verify gate-criterion *behavior*, not just existence. The eight checks for any future close:

1. Every plan §Phase-N gate criterion exercised end-to-end on a real artifact (save → load → run → export → fork → reload).
2. Every documented script path runs successfully on a typical input — `grep -rn "scheduled for Phase" scripts/` returns only stubs in not-yet-opened phases.
3. Every writer that landed in this phase has an integration test proving the producer actually invokes it (round-trip the producer's output through the writer's `load_*`).
4. Every new validator field corresponds to a producer field that was added in the same workstream — diff the validator and producer commits.
5. Every exporter validates the full plan before any destructive op; tests assert source-survival on self-export.
6. Every UI panel that promises to show X has a test that asserts X is in the rendered output, not just that the component file exists.
7. README + CLAUDE.md + milestone + timeline all agree on phase status — `grep -nE "Phase NN" <files>` reads every match.
8. `scripts/build/*.sh` succeeds; the source tree has no `.js` or `.d.ts` artifacts after the build.

A close commit that skips any of these is rolled back, the new patterns are re-read, and the work is finished. Phases 1 and 2 each shipped a false-close — the third has one less excuse.

---

## 2026-05-02: Phase 1 false close — seven legitimate review findings

### Affected subsystem
Repository-wide. Phase 1 close at commit `37132a5` claimed Phase 1 complete; user review identified seven outstanding issues spanning the convention checker, the runtime checkpoint guard, the API server, the `python_cpu` backend's placeholder handling, ruff cleanliness, status sync, and the plan's Phase Gate items.

### Symptoms
1. Phase Gate items 4 and 5 (capsule save / reload) marked Phase-2-deferred without ADR authority. Plan §1772 lists both as Phase 1 close requirements; close commit silently narrowed the contract.
2. Default convention checker still showed 148 checks — same as before any 1C/1D/1E/1F work landed. Completed deliverables remained inside the `--include-open-workstreams` opt-in branch and never ratcheted into the hard gate.
3. `simworkbench.runtime.checkpoint.checkpoint_dir()` ran `mkdir(parents=True, exist_ok=True)` *before* `write_checkpoint()`'s `is_under_workbench()` guard. Regression tests passed because they only asserted the exception, not the absence of `/tmp/checkpoints/` and `~/elsewhere/checkpoints/` on disk.
4. The example ModelSpec flags its rate constant as a placeholder (`coefficient_sources: ["placeholder: ..."]`), but `RunSummary.placeholder_used` always returned False. The `python_cpu` backend used the same `1.0/s` default for placeholder *and* unsourced rates — silent fabrication risk per `agent_error_patterns.md` "Silently inventing missing physical coefficients".
5. `_RUNS` was module-global in `packages/core/src/simworkbench/api/server.py`. `create_app()`'s docstring claimed isolation but the registry leaked across apps. Reordering `test_start_run_executes_simple_rate_equations` before `test_runs_list_initially_empty` flipped the latter from passing to failing.
6. CLAUDE.md "Phase-Specific Operational Notes" still said "Phase 1 has not started" and "Workstreams 1C-1F are pending". The milestone top header said "Complete" but the per-workstream subsections still showed `☐ Open` checkboxes for 1C/1D/1E/1F.
7. `ruff check` produced 28 violations across `packages/core/src/`, `packages/physics_modules/`, and `tests/`. AGENTS.md "Code Style and Module Boundaries" requires ruff clean; the close commit ran pytest + the convention checker but never ran ruff.

### Root cause
Six separate but related agent failure modes, each now logged in `agent_error_patterns.md` as a named pattern:

- *Unilaterally redefining a Phase Gate item during the close* — issue 1.
- *Closing a workstream without promoting its assertions from opt-in to default* — issue 2.
- *Side-effecting before validating* — issue 3.
- *API factory advertises isolation while sharing module-global state* — issue 5.
- *Status-sync that misses CLAUDE.md and per-workstream subsections* — issue 6.
- *Skipping the linter the repo rules require* — issue 7.

Issue 4 (placeholder coefficient handling) is a recurrence of the existing pattern *Silently inventing missing physical coefficients* combined with insufficient API surfacing; the agent treated "placeholder is OK because it's flagged in the YAML" as sufficient when the runtime needs to (a) refuse unsourced non-placeholder rates and (b) propagate `placeholder_used` through the API to the UI.

### Fix
A series of follow-up commits, each addressing one issue in isolation:
- Commit X (this one): reopen Phase 1 status, log this bugfix, add the six new patterns to `agent_error_patterns.md`.
- Subsequent commits: checkpoint guard order, placeholder surfacing + non-fabrication, API state isolation, ruff cleanup + lint script, capsule save/reload (Phase Gate items 4-5), opt-in→default promotion, status sync.
- Final close commit when all seven issues are green AND the default checker covers every Phase 1 entity.

### Regression protection
Each of the six patterns has a Detection section. Where a regression test is feasible:
- Issue 2: convention checker self-check verifies default-mode count is non-decreasing across workstream closes.
- Issue 3: regression test asserts `Path("/tmp/checkpoints").exists()` is False after a refusal — not just that the exception was raised.
- Issue 5: integration test creates two app instances, registers state in one, asserts the other doesn't see it.
- Issue 7: `scripts/test/all.sh` calls `scripts/test/lint.sh` (new) which runs ruff.

### Agent warning
A "close" commit is the moment to be most paranoid, not least. Six checks the agent must run before a close commit:
1. Every plan §Phase-N gate item ticked (or paired with an Accepted ADR deferring it).
2. Default convention checker count strictly higher than at workstream open.
3. Ruff clean.
4. Status grep across README, AGENTS, CLAUDE, program_development, docs_site, apps yields zero contradictory references.
5. Side-effect-before-validate grep clean (any new `mkdir` / `open(..., "w")` in workbench code preceded by a guard).
6. Module-global mutable state grep clean in API factories.

A close commit that skips any of these is rolled back, the patterns are re-read, and the work is finished.

## 2026-05-02: Per-app and per-package `build/` outputs were not gitignored

### Affected subsystem
`.gitignore` (root-level), discovered while opening Workstream 1F.

### Symptoms
`git check-ignore -v apps/workbench-ui/build/foo.js` reported the path was **not** matched by any ignore rule. Same for `packages/core/build/foo.py`. Once the UI ships and its build tool emits to `apps/workbench-ui/build/` (some tools — Astro/CRA — do), those outputs would be staged by accident.

### Root cause
The earlier `build/` → `/build/` fix anchored the rule to the repository root to stop it swallowing `scripts/build/` — correct, but it left every per-app and per-package `build/` directory unprotected. The `bugs_and_fixes/agent_error_patterns.md` "Bare gitignore globs" pattern explicitly prescribes the full fix:
> Anchor build-output ignores to where they are produced:
> - `/build/` for top-level outputs
> - `apps/*/build/` for per-app outputs
> - `packages/*/build/` for per-package Python build artifacts (if used)

The first bullet was applied earlier; the other two were not. The Workstream 1F open ran the bug-memory grep procedure, which surfaced the pattern, then ran `git check-ignore -v apps/workbench-ui/build/foo.js` and confirmed the gap.

### Fix
Added `apps/*/build/` and `packages/*/build/` to `.gitignore` directly below `/build/`. Reality-test reconfirms: `apps/workbench-ui/build/foo.js` and `packages/core/build/foo.py` are now ignored, while `scripts/build/ui.sh` and `scripts/build/.gitkeep` remain tracked.

Caught and fixed as part of the Workstream 1F open commit.

### Regression protection
- `scripts/dev/check_repo_conventions.sh` extended with a "build/ output ignore tiers" section that probes `apps/workbench-ui/build/`, `packages/core/build/`, and `/build/` and asserts each is matched by an ignore rule. Cross-references the existing source-paths-not-ignored regression which asserts `scripts/build/ui.sh` is NOT ignored. Both regressions live in the default checker so a future overly-narrow change shows up immediately.

### Agent warning
When you anchor a `build/` ignore, do not stop at `/build/`. The pattern requires `/build/` AND `apps/*/build/` AND `packages/*/build/` together — root-anchored alone leaves per-app and per-package outputs exposed. After any `.gitignore` change, run `git check-ignore -v` against probes in every directory tier (`apps/<name>/build/`, `packages/<name>/build/`, `/build/`, `scripts/build/<name>`) before commit.

## 2026-05-02: Open workstream TODOs broke the default test gate

### Affected subsystem
`scripts/dev/check_repo_conventions.sh`, `scripts/test/all.sh`, Phase 1 milestone tracking.

### Symptoms
Opening Phase 1 Workstreams 1C, 1D, and 1E inserted intentionally failing TODO assertions into the default convention checker. As a result, `./scripts/test/all.sh` failed before running pytest even though the implemented 1A/1B unit and integration tests were green. The TODO backlog also under-covered the plan: the 1C progress test was missing, the `run_backend.sh` Phase-0 stub satisfied only the generic executable check, and the 1D module template source/test files were not asserted.

### Root cause
The checker mixed two different concepts: hard repository invariants for completed work and intentionally failing assertions for open implementation backlog. Because `scripts/test/all.sh` calls the default checker, expected TODO failures became normal test failures. The workstream-opening checklist also counted grouped prose instead of every named file/assertion.

### Fix
Split the convention checker into default hard-gate mode and opt-in open-workstream mode. `scripts/dev/check_repo_conventions.sh` now passes for completed repository invariants, while `scripts/dev/check_repo_conventions.sh --include-open-workstreams` exposes the 1C/1D/1E backlog. Added missing opt-in assertions for `tests/unit/test_runtime_progress.py`, the real `scripts/dev/run_backend.sh` implementation, and `packages/physics_modules/templates/module_template/{src/__init__.py,tests/test_template.py}`. Updated README, docs, milestone notes, `AGENTS.md`, and `CLAUDE.md`.

### Regression protection
- `tests/regression/test_convention_checker_modes.py` asserts that default checker mode passes while opt-in mode reports the current corrected Phase 1 backlog.
- `scripts/test/all.sh` continues to call only default checker mode before running pytest.

### Agent warning
Do not put intentionally failing workstream TODO assertions in the default checker path. The default convention checker is the hard gate for completed work; open backlog belongs behind `--include-open-workstreams` and must not break the normal test runner.

## 2026-05-02: Phase 1A/1B gate overstated implementation completeness

### Affected subsystem
`packages/core/src/simworkbench/{model_spec,experiment,serialization,units}/`, `scripts/test/`.

### Symptoms
Phase 1 Workstreams 1A and 1B were documented around ModelSpec and units, but verification found plan-level gaps:

- Workstream 1A had ModelSpec but not `Experiment`, `RunConfig`, `DiagnosticConfig`, `BackendConfig`, or experiment save/load.
- ModelSpec unit enforcement only covered typed `Quantity` fields; raw floats passed through flexible dictionaries such as `fields.initialization` and `interactions.valid_regime`.
- Several plan §8.2 ModelSpec validation rules were missing: missing species, unknown equation references, missing coefficient sources, unsupported backends, unknown validity-regime keys, missing spatial bounds, and missing spatial boundary conditions.
- `scripts/test/*.sh` used ambient `python`, so tests failed outside an activated `.venv` even though the repo-local virtualenv had the required dependencies.
- README status text still described Phase 0 while the phase table showed Phase 1 in progress.

### Root cause
The convention checker and milestone notes verified file presence and the ModelSpec slice, not the complete Workstream 1A deliverable list or behavioral validator coverage. Flexible `dict[str, Any]` fields created a unit-validation escape hatch. Test wrappers assumed the user's shell had already activated the repo virtualenv.

### Fix
Implemented `simworkbench.experiment` with `Experiment`, `RunConfig`, `DiagnosticConfig`, and `BackendConfig`. Added `simworkbench.serialization` experiment YAML save/load helpers. Hardened ModelSpec validators for flexible parameter dictionaries and the missing plan §8.2 checks listed above. Updated test wrappers to prefer `.venv/bin/python`. Synced README, docs, milestone, timeline, convention checker, and regression records.

Commit: `f90a56a` (`Complete Phase 1A core model and harden units validation`).

### Regression protection
- `tests/unit/test_modelspec.py` now covers raw numeric bypasses, missing species, unknown equation refs, missing coefficient sources, unsupported backends, unknown validity-regime keys, and missing spatial bounds/boundary conditions.
- `tests/unit/test_experiment.py` covers core experiment/config models.
- `tests/integration/test_experiment_save_load.py` covers experiment YAML save/load.
- `scripts/dev/check_repo_conventions.sh` now asserts the new implementation/test files and test-wrapper virtualenv behavior.

### Agent warning
Do not treat one slice of a workstream as the full workstream. Translate every named plan deliverable into implementation and tests. Avoid `dict[str, Any]` at scientific boundaries unless it has recursive validation that rejects raw physical numbers.

## 2026-05-02: Phase 0 gate false positive for missing skeleton files

### Affected subsystem
Repository bootstrap / convention checker / development history.

### Symptoms
Phase 0 was marked complete even though several plan-required or README-advertised artifacts were missing:

- milestone files existed only for Phase 0-5 and several filenames did not match plan phase numbers;
- `apps/workbench-ui/package.json`, `apps/workbench-ui/tsconfig.json`, `packages/core/pyproject.toml`, and `packages/core/src/simworkbench/__init__.py` were absent despite the plan's initial tree;
- README-documented wrapper scripts such as `scripts/docs/dev.sh`, `scripts/docs/build.sh`, and `scripts/test/all.sh` did not exist;
- `README.md` still marked Phase 0 as in progress while the milestone/timeline marked it complete.

### Root cause
The Phase 0 convention checker verified broad directories and a small milestone subset, but did not verify the full plan-matching skeleton, executable documented scripts, or Phase 0-10 milestone coverage. Documentation and milestone status drifted after the gate was marked as passed.

### Fix
Added the missing Phase 0 package skeleton files, documented command wrappers, and plan-matching milestone files for Phase 0 through Phase 10. Removed stale Phase 2-5 milestone filenames. Extended `scripts/dev/check_repo_conventions.sh` to verify the missing package files, executable scripts, and all Phase 0-10 milestone files. Updated README, docs-site pages, development timeline, and bug-memory records to reflect the corrected gate.

Commit: `11e04f1` (`Fix Phase 0 bootstrap gate coverage`).

### Regression protection
- `scripts/dev/check_repo_conventions.sh` now checks all corrected artifacts and passes with 116 checks.
- `bugs_and_fixes/regression_tests.md` cross-lists this convention checker guard.

### Agent warning
Do not mark a phase gate complete from directory-level checks alone. Check the exact deliverables named by the plan, README command paths, and development-history naming rules.

## 2026-05-02: Bare `build/` ignore rule swallowed `scripts/build/`

### Affected subsystem
`.gitignore` (root-level)

### Symptoms
Files placed under `scripts/build/` (intended location of build scripts per the planned §19 commands like `scripts/build/ui.sh`) were silently ignored by git. `git check-ignore` traced the match to `.gitignore:18:build/`. The convention checker still passed because it only verified directory existence, not that the directory's *contents* were trackable.

### Root cause
The plan §3.2 specifies a bare `build/` ignore rule, intended for top-level Node/Vite build output. As written, `build/` matches every directory named `build` anywhere in the tree — including `scripts/build/`, which we explicitly use for build scripts.

Once a directory is ignored, gitignore's negation rules cannot re-include files inside it: "It is not possible to re-include a file if a parent directory of that file is excluded." So a simple `!scripts/build/` does not solve it.

### Fix
Replaced `build/` with `/build/` in `.gitignore`, anchoring the rule to the repository root. Added an inline comment explaining why and warning future agents not to reintroduce a bare `build/`. Top-level Node/Vite/Python build artifacts still get ignored; `scripts/build/`, `packages/<x>/build/`, and any other nested `build/` directory remain trackable.

Commit: `db040b6` (`Bootstrap Phase 0: governance, docs, bug memory, and autonomous git`).

### Regression protection
- Added `scripts/build/.gitkeep` so the directory is staged.
- Documented the trap in `agent_error_patterns.md` (entry: "Bare gitignore globs that conflict with project directories").
- Extended `scripts/dev/check_repo_conventions.sh` to verify representative source paths under `scripts/build/`, `scripts/dev/`, `scripts/test/`, `scripts/docs/`, `packages/physics_modules/`, `apps/workbench-ui/`, and `docs_site/` are not gitignored.

### Agent warning
Do not generalize a `build/` ignore rule across the whole tree. Project directories whose name happens to be `build` exist deliberately. Anchor build-output ignores to the place they are produced, or use specific patterns like `apps/*/build/`.

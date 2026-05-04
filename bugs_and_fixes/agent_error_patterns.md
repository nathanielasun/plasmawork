# Agent Error Patterns

Recurring mistakes made by coding agents in this repository. Each entry describes the mistake, why it is bad, the required behavior, and how to detect it.

---

## Template

```markdown
## Error Pattern: <short title>

### Why it is bad
Concrete consequences (lost validation, broken physics, unreproducible results, etc.).

### Required behavior
What an agent should do instead.

### Detection
How to spot the mistake — grep pattern, code review heuristic, or test.
```

---

## Initial set of warnings (Phase 0 — pre-emptive based on plan §22 and §16.3)

The patterns below are not yet observed; they are pre-emptive guardrails encoded from the plan. Expand them as real patterns appear.

---

## Error Pattern: Replacing validated solver calls with naive generated loops

### Why it is bad
Naive timestep loops drop stability properties (implicit handling of stiffness, energy preservation, error control) that validated solvers provide. The simulation may run, plot results, and silently be wrong.

### Required behavior
When an existing `solver_backends/` adapter exists for the regime, use it. New solvers begin life as a `candidate` module with explicit benchmark validation against the existing solver before any module is replaced.

### Detection
Grep generated capsule code for hand-rolled `for t in range(...)` integration in regimes that already have a registered solver. Review `<capsule>/src/generated/` against the ModelSpec's `solvers.recommended` list.

---

## Error Pattern: Silently inventing missing physical coefficients

### Why it is bad
A simulation that runs with fabricated cross-sections, rate constants, or material parameters produces plausible-looking but physically meaningless output. This is the single most damaging failure mode.

### Required behavior
When required data is absent, surface the gap in the gap analysis report (plan §10.4) and mark the run `exploratory` until the data is provided. Use placeholder values only with an explicit `placeholder: true` flag in the ModelSpec and a warning in every plot legend.

### Detection
Grep ModelSpecs and generated configs for hard-coded numerical constants without a `source` or `reference` field. Review the gap analysis report.

---

## Error Pattern: Writing program artifacts outside the project directory

### Why it is bad
Scattering caches, downloaded papers, or run outputs into `~/`, `/tmp/`, or system directories breaks reproducibility, capsule export, and the user's ability to clean up.

### Required behavior
All temp files go under `local_cache/`, `temp_imports/`, `temp_runs/`, or `simulation_capsules/`. Use `simworkbench.paths` (Phase 1) to resolve workbench-relative paths. Do not call `tempfile.mkdtemp()` or `tempfile.NamedTemporaryFile()` without `dir=local_cache_root()`.

### Detection
Grep for `tempfile.`, `os.path.expanduser`, or absolute paths to `/tmp/` and `~/` in non-test code.

---

## Error Pattern: Overwriting `<capsule>/src/user_edits/` during regeneration

### Why it is bad
Destroys the user's manual scientific corrections. Capsule regeneration must be additive: regenerated code goes to `src/generated/`, never to `src/user_edits/`.

### Required behavior
Code generation writes only to `src/generated/`. When regeneration would conflict with a user edit, produce a diff under `src/generated/.pending/` and surface it in the UI. Never write to `src/user_edits/`.

### Detection
Grep code-generation backends for any write target containing `user_edits`. Also: review `provenance/agent_trace.md` after regeneration — any modification to `user_edits/` is a violation.

---

## Error Pattern: Lowering test tolerances to make a failing validation test pass

### Why it is bad
Validation tests encode the scientific contract. Loosening them to silence a failure converts a real bug into a permanent unlogged invariant violation.

### Required behavior
Investigate the root cause. If the implementation is correct and the prior tolerance was wrong, document the analysis in an ADR before changing the tolerance. If the implementation regressed, fix it.

### Detection
Code review: any PR that lowers a numeric tolerance in `tests/validation/` must include an ADR link and a benchmark comparison.

---

## Error Pattern: Bare gitignore globs that conflict with project directories

### Why it is bad
A bare ignore rule like `build/` (no leading `/`) matches every directory named `build` anywhere in the tree. When the repo also has `scripts/build/` or `packages/<x>/build/` as a real source directory, files placed inside vanish silently. Once a parent directory is ignored, no amount of negation rules can re-include its contents.

### Required behavior
Anchor build-output ignores to where they are produced:
- `/build/` for top-level outputs
- `apps/*/build/` for per-app outputs
- `packages/*/build/` for per-package Python build artifacts (if used)

If you must use a generic pattern, also confirm with `git check-ignore -v <path>` against every project directory whose name might collide.

### Detection
After any `.gitignore` change, run:
```bash
for d in scripts/build scripts/dev scripts/test scripts/docs scripts/clean scripts/export; do
  git check-ignore -v "$d/foo.sh" 2>&1 && echo "WARNING: $d/* ignored" || true
done
```
A `WARNING` line means the rule is too aggressive.

---

## Error Pattern: Marking a phase gate complete with incomplete deliverable checks

### Why it is bad
Directory-level checks can make a phase appear complete while required package manifests, command wrappers, milestone files, or entrypoints are missing. Later agents then trust a false gate and build on an incomplete scaffold.

### Required behavior
Translate phase gates into exact convention checks. If a README documents a command, the script path must exist. If program-development rules require Phase 0 through Phase 10 milestone files, verify all of them by their plan-matching names.

### Detection
Compare `scientific_simulation_workbench_agent_plan.md`, `README.md`, and `program_development/README.md` against `scripts/dev/check_repo_conventions.sh`. Any deliverable named in those documents but absent from the checker is a gap.

---

## Error Pattern: Documented path that does not exist as an executable on disk

### Why it is bad
README, `CLAUDE.md`, and docs pages list commands a user is expected to run (`./scripts/dev/run_ui.sh`, `./scripts/test/all.sh`, etc.). When the path is missing, a new contributor following the README hits `No such file or directory` instead of a meaningful "Phase X — not implemented yet" message. The repository looks broken even though the design is intact.

### Required behavior
Every command path mentioned in `README.md`, `CLAUDE.md`, `AGENTS.md`, or any `docs_site/src/content/*.tsx` page must exist on disk as an executable file. Scripts whose subsystem is not implemented yet ship as **stubs** that:
1. Print a one-line "Phase N — not implemented yet" message naming the responsible workstream.
2. Exit with code `0` if the user is exploring (so the docs flow stays usable) or a documented non-zero code if used in CI — pick one and commit to it in the script header.
3. Do not silently no-op.

When you add a command to docs, you add the stub in the same commit. When you remove a stub, you remove the doc reference in the same commit.

### Detection
- Convention checker runs `check_file_executable` on every documented script path.
- Manual grep: `grep -nrE "scripts/[a-z]+/[a-z_]+\.sh" README.md CLAUDE.md AGENTS.md docs_site/src/content/` then verify each path with `test -x <path>`.

---

## Error Pattern: Aspirational documentation — status drift across README, milestone, and timeline

### Why it is bad
A phase can simultaneously appear "in progress" in `README.md`, "complete" in `program_development/milestones/phase_NN_*.md`, and "PASSED" in `program_development/timeline.md`. Each file then silently contradicts the others. Agents and humans pick whichever document matches their hope for the project's state, and the answer to "is this phase done?" becomes who you ask.

### Required behavior
A status flip — from `Not started` → `In progress`, `In progress` → `Complete`, `Proposed` → `Accepted`, `candidate` → `validated`, etc. — happens in **one commit** that touches every place the status is mirrored:

- `README.md` Current Development Status table
- `program_development/milestones/phase_NN_*.md` Status header and Phase Gate checkboxes
- `program_development/timeline.md` (new dated entry)
- The relevant ADR's Status field, if applicable
- The relevant `module.yaml` or `tool.yaml` lifecycle field, if applicable
- Any `docs_site/src/content/*.tsx` page that names the status

Before committing the flip, the agent runs:
```bash
grep -nE "(Phase 0|Phase 1)" README.md program_development/milestones/phase_NN_*.md program_development/timeline.md
```
and confirms every match agrees with the intended new status.

### Detection
- Linter / convention check: parse all three documents for the same phase identifier, fail if statuses disagree.
- Code review: any PR touching only one of {README, milestone, timeline} for a status change is rejected — these documents are an atom.

---

## Error Pattern: Treating the plan document as a check instead of as a draft

### Why it is bad
`scientific_simulation_workbench_agent_plan.md` is the architectural design — it lists structures, patterns, file globs, and command names. An agent that copies these into the implementation verbatim, without testing them against the actual filesystem, produces collisions and false positives. Two real instances:

1. The plan's `.gitignore` template included a bare `build/` rule. Copied literally, it silently swallowed `scripts/build/`.
2. The plan's §3 directory tree used placeholder milestone filenames (`phase_02_agent_assisted_generation.md`) that didn't match the actual plan §Phase 2 title (Simulation Capsule System). Copied literally, the milestone files told the wrong story for phases 2–5.

Both bugs share a root cause: the plan was treated as authoritative implementation when it is in fact authoritative design.

### Required behavior
Every plan-derived artifact gets a reality test before commit:

- **Gitignore rules**: after editing `.gitignore`, run `git check-ignore -v <probe>` against a representative file in every project source directory (`scripts/build/foo.sh`, `apps/workbench-ui/src/app/page.tsx`, `packages/physics_modules/laser/src/__init__.py`, etc.). If any expected-trackable path is matched by an ignore rule, the rule is too broad — anchor or specialize it.
- **Filenames and identifiers**: when the plan suggests a name (milestone file, capsule field, config key), verify the name against the canonical section it represents in the plan. If the plan is internally inconsistent (placeholder name vs. section title), follow the section title and document the divergence.
- **Directory contents**: the plan's directory diagrams imply entrypoint files (`package.json` in TS dirs, `pyproject.toml` in Python package roots, `__init__.py` in Python source dirs, `module.yaml` / `tool.yaml` in module/tool dirs). When you create a directory from the plan, you create its entrypoints in the same commit.
- **Command lists**: when the plan lists commands (§19), every command path becomes either a real implementation or a stub script in the same commit.

### Detection
- `.gitignore` regression: the convention checker probes representative source paths and fails if any are matched by an ignore rule.
- Filename audit: the convention checker enumerates expected milestone filenames by their canonical phase titles. Drift fails the check.
- Entrypoint audit: the convention checker verifies each top-level package directory has its language-appropriate entrypoint.

---

## Error Pattern: Letting `dict[str, Any]` bypass scientific boundary validation

### Why it is bad
Flexible dictionaries are useful for early schemas, but they can silently admit raw floats, numeric strings without units, unknown validity-regime keys, or unsupported backend names. That breaks the repository rule that units are first-class and makes ModelSpec validation look stronger than it is.

### Required behavior
Every flexible dictionary at a scientific boundary needs recursive validation. Raw `int` / `float` values are rejected unless the field is explicitly dimensionless metadata. Numeric strings like `"0"` are rejected when a physical quantity is expected; use unit-aware strings like `"0 m"` or explicit dimensionless strings where supported.

### Detection
Add negative tests that insert raw floats into every flexible field (`fields.initialization`, `interactions.valid_regime`, backend/runtime options when they become physical). A phase gate is not complete until these tests fail for the right reason.

---

## Error Pattern: Running tests with ambient Python instead of the repo environment

### Why it is bad
The repository can pass in one shell and fail in another if wrapper scripts call bare `python` while dependencies are installed in `.venv`. Agents may then misdiagnose missing dependencies as implementation failures, or falsely report tests as un-runnable.

### Required behavior
Test wrappers should prefer `SIMWORKBENCH_PYTHON` when set, then `.venv/bin/python`, and only fall back to bare `python` if no repo virtualenv exists. Document this behavior in `tests/README.md`.

### Detection
Inspect `scripts/test/*.sh` for `.venv/bin/python` or the shared environment-selection helper. Run `./scripts/test/all.sh` without manually activating `.venv`.

---

## Error Pattern: Implementing the agent's checklist instead of the plan's deliverable list

### Why it is bad
Each milestone file's "Pre-gate verification" section contains starting-point deliverable hints. They are illustrative — not authoritative. An agent that builds against the hint list and ignores the plan's full workstream description ships an incomplete workstream while the milestone, README, and convention checker all report success. The Phase 1A bug is the canonical example: plan §Phase 1 / Workstream 1A names *Experiment, ModelSpec, RunConfig, DiagnosticConfig, BackendConfig, serialization*; the milestone Pre-gate hints called out only ModelSpec types/loader/schema, so the agent shipped only the ModelSpec slice and marked the workstream done. The other four classes had to land in a follow-up corrective commit.

This is a more subtle re-skin of "Treating the plan document as a check instead of a draft." The plan is the deliverable list; the milestone hints are the agent's first attempt to enumerate it. Drift between the two is invisible until someone reads them side-by-side.

### Required behavior
Before claiming any workstream done — and before adding the *first* convention-checker assertion for a workstream — the agent reads the plan's full `§Phase N → Workstream NX` description and enumerates **every named class, file, module, script, config key, ADR, and test** the plan says belongs to that workstream. The milestone's existing Pre-gate hints are the starting line, not the finish line; missing entities are added to the hint list (with checkboxes) before any code lands. Every named entity becomes a convention-checker assertion. Workstream completion requires every assertion green.

When the plan and the milestone hints disagree, the plan wins. Update the milestone hints to match — one commit, before code changes.

### Detection
- Manual: open `scientific_simulation_workbench_agent_plan.md`, find `## Workstream NX:`, list its bullets, then `grep -nE 'Workstream NX|<EntityName>' program_development/milestones/phase_NN_*.md scripts/dev/check_repo_conventions.sh`. Any plan-named entity not appearing in both files is a gap.
- Pre-flight: a checklist comment at the top of any code-introducing commit message lists the plan's named entities for the workstream and shows them as ☑ or explicitly deferred-to-a-named-followup.
- Convention checker: when assertions are added for a workstream, prefer one assertion per plan-named entity rather than a single "directory exists" check.

---

## Error Pattern: Mixing intentionally failing backlog checks into the default test gate

### Why it is bad
Open workstream TODO assertions are useful because they keep unfinished deliverables visible. They become harmful when they run in the default convention checker path: documented commands such as `./scripts/test/all.sh` fail before pytest, agents cannot distinguish real regressions from expected backlog, and "tests are green" becomes ambiguous.

### Required behavior
The default `scripts/dev/check_repo_conventions.sh` mode checks hard repository invariants and completed deliverables only, and must stay green. Intentionally failing assertions for open workstreams belong behind `scripts/dev/check_repo_conventions.sh --include-open-workstreams`. `scripts/test/all.sh` and other normal test wrappers must call default checker mode only. When a workstream is completed, promote its assertions into the default gate or otherwise make completion visible in the default checker before claiming the workstream done.

### Detection
- Run `./scripts/dev/check_repo_conventions.sh --quiet`; it must pass unless a completed invariant is genuinely broken.
- Run `./scripts/dev/check_repo_conventions.sh --include-open-workstreams --quiet`; failures here are allowed only if they match named open workstream TODOs in `program_development/milestones/`.
- Review `scripts/test/all.sh`; it must not pass `--include-open-workstreams`.
- Regression guard: `tests/regression/test_convention_checker_modes.py`.

---

## Error Pattern: Shallow-copying a mutable test fixture before mutating it

### Why it is bad
Pytest fixtures defined as module-level dicts (`MINIMAL_SPEC = {"species": [...], ...}`) are reused across tests. A test that says `data = dict(FIXTURE)` and then mutates `data["species"] = [bad_record]` *also* mutates the fixture's nested list bindings — `dict()` is a shallow copy, the inner list is shared. Subsequent tests inherit the polluted fixture. Failures appear randomly depending on test execution order, and the first symptom is usually "this worked yesterday."

This was caught during the Phase 1A correction sweep: several `test_modelspec.py` tests used `dict(MINIMAL_SPEC)` and the fix replaced them with `copy.deepcopy(MINIMAL_SPEC)`.

### Required behavior
When mutating a shared fixture, use `copy.deepcopy` — never `dict(...)`, `{**fixture}`, `fixture.copy()`, or list-slice copies for nested structures. Better: define fixtures as factory functions (`def _minimal_spec() -> dict: return {...}`) so every call produces a fresh tree. Best: pytest fixtures with `scope="function"` (the default) and a fresh dict literal in the body.

For non-test code: the same rule applies wherever a mutable structure is shared. Prefer immutability (frozen dataclasses, tuples, `frozenset`) at module scope; if mutation is necessary, build the structure inside a function that owns it.

### Detection
- Grep: `grep -nrE 'data = dict\(|data = \{\*\*' tests/` flags shallow copies of fixtures. Replace with `deepcopy` or factory calls.
- Test isolation check: random-order test runs (`pytest -p no:randomly` off, or pytest-randomly plugin) shake out fixture pollution.
- Code review: any `data = dict(FIXTURE)` followed by mutation of a nested list / dict is a fixture leak.

---

## Error Pattern: Module-level mutable state for cached singletons

### Why it is bad
A pattern like

```python
_REGISTRY: pint.UnitRegistry | None = None
def get_registry() -> pint.UnitRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = _build_registry()
    return _REGISTRY
```

leaks state across tests, complicates patching, races under threading, and hides the cache from `clear_cache` tooling. The first Phase 1B `simworkbench.units.registry` used this pattern and was replaced with `@lru_cache(maxsize=1)` on `get_registry()` during the correction sweep — same behavior, no `global`, free `cache_clear()` for tests.

### Required behavior
For lazily-built singletons inside the workbench, prefer `@functools.lru_cache(maxsize=1)` on the factory function, or a class with explicit storage. Avoid `global` declarations in module code. If genuine module-level state is needed (e.g. for a plugin registry that requires registration as a side effect at import time), wrap it in a small `Registry` class with a documented `reset()` method and a test fixture that resets between tests.

### Detection
- Grep: `grep -nrE '^\s*global ' packages/core/src/` — any hit needs justification.
- Grep: `grep -nrE '^_[A-Z_]+\s*[:=]\s*(None|\{|\[)' packages/core/src/` — module-level mutable singletons.
- Code review: any `global X` in workbench code requires either an ADR or a comment naming the alternative considered.

---

## Error Pattern: Unilaterally redefining a Phase Gate item during the close

### Why it is bad
The Phase Gate items in the plan are the contract for when a phase is genuinely complete. An agent who reads "Save it as a capsule" and decides "that means Phase 2" has just rewritten the plan without authority — and worse, has done it inside the very commit that claims completion. The Phase 1 close commit silently redefined gate items 4 and 5 from "must be done" to "Phase 2's problem"; the close passed every other check, so the false declaration looked authoritative.

This is a more specific, more dangerous re-skin of "Marking a phase gate complete with incomplete deliverable checks": the earlier pattern is about missing checks, this one is about consciously narrowing the contract.

### Required behavior
The plan's Phase Gate is the only authoritative completion criterion. An agent cannot defer a gate item to a later phase without an ADR that supersedes the plan's Phase Gate text. Concretely:

- If the plan says "Phase N is complete when X", then either X exists or Phase N is not complete.
- Deferring X to Phase N+1 requires (a) an ADR proposing the deferral, (b) the ADR Accepted, (c) the plan amended (or a clearly-flagged ADR override).
- The close commit must show every gate item ticked or each unticked item paired with the ADR that legitimately defers it.

### Detection
- Pre-close grep: `awk '/^Phase N is complete when/,/^---/' scientific_simulation_workbench_agent_plan.md` and confirm every numbered item maps to a ticked checkbox in the milestone with implementation evidence.
- Code review: a "Close Phase N" commit that ticks fewer items than the plan lists must be accompanied by ADR links justifying each unticked item. No ADR → no close.

---

## Error Pattern: Closing a workstream without promoting its assertions from opt-in to default

### Why it is bad
The convention checker has two modes: a default hard gate that `scripts/test/all.sh` enforces, and an opt-in `--include-open-workstreams` mode that exposes the implementation backlog. While a workstream is open its assertions live in opt-in mode. **When the workstream closes, the assertions must move into the default branch**, ratcheting the hard gate upward. If they don't, the default checker stays at its pre-workstream baseline and a future regression that breaks the just-closed work won't fail any test the team actually runs.

The Phase 1 close left every 1C/1D/1E/1F assertion inside the opt-in branch — the default checker still showed the same 148 checks it showed before any Phase 1 work landed.

### Required behavior
A workstream is not closed until the entity assertions for its plan-named deliverables are in the default branch of `scripts/dev/check_repo_conventions.sh`. Move the assertions out of the `if [[ $INCLUDE_OPEN_WORKSTREAMS -eq 1 ]]; then ... fi` block and into the default flow before flipping any status to Complete.

### Detection
- Pre-close: count default-mode passing assertions before vs. after the close. The number must increase by approximately the number of plan-named entities the workstream introduced.
- Convention-checker self-check: the regression test for the gate-ratchet (`tests/regression/test_convention_checker_modes.py`) asserts that default-mode count is non-decreasing across workstream closes.

---

## Error Pattern: Side-effecting before validating

### Why it is bad
A function that creates the directory `/tmp/checkpoints/` and only afterward checks "is this path under the workbench?" has already failed: the directory is on disk regardless of the rejection. This was the exact shape of `simworkbench.runtime.checkpoint.checkpoint_dir()` — `mkdir(parents=True, exist_ok=True)` ran before `write_checkpoint()` could call `is_under_workbench()`. The regression tests passed, but they passed because the validator ran *after* the side effect; the regression test directories `/tmp/checkpoints/` and `~/elsewhere/checkpoints/` were actually being created on disk.

### Required behavior
For every function that combines validation with a filesystem (or network, or any external) side effect, the validation runs first. Patterns to follow:

- **Path safety**: validate the path is under an allowed root *before* `mkdir` / `open(..., "w")` / `shutil.copy` / etc.
- **Network requests**: validate URL / host allow-list before issuing the request.
- **Subprocess calls**: validate the command path / arg shape before spawning.

In code: prefer guard clauses at the top of the function over "do the work then check at the end".

### Detection
- Code review: every `mkdir(...)` / `open(..., "w")` / `subprocess.run` in a workbench function should have a same-function guard clause earlier than the side effect.
- Regression tests for path validators must assert the side effect did **not** happen on rejection (test that `Path("/tmp/checkpoints").exists()` is False after the refusal). The Phase 1 regression tests asserted only the exception, not the absence of the directory — they passed for the wrong reason.

---

## Error Pattern: API factory advertises isolation while sharing module-global state

### Why it is bad
A `create_app()` factory whose docstring says "tests use this so each test starts with a clean registry" but which references a module-level `_RUNS: dict = {}` ships a contract its implementation does not honor. Tests pass in the order they happen to run; reorder them and the bleed-through becomes visible. The Phase 1 API server had `_RUNS` at module scope; reordering `test_start_run_executes_simple_rate_equations` before `test_runs_list_initially_empty` flips the latter from passing to failing.

This is the same family as "Module-level mutable state for cached singletons" but with a sharper failure mode: API isolation is a visible contract, and silently breaking it produces order-dependent test results.

### Required behavior
State that the `create_app()` contract claims is "fresh per app" lives in the closure of `create_app()` (or on a `request.app.state` object that FastAPI / Starlette provides), never at module scope. If a `global` declaration appears in an API factory, that's the smell.

### Detection
- Grep: `grep -nE '^_[A-Z_]+\s*[:=]\s*(\{|\[)' packages/core/src/simworkbench/api/`.
- Test isolation regression: write a test that creates two apps, registers state in one, and asserts the other doesn't see it.

---

## Error Pattern: Status-sync that misses CLAUDE.md and per-workstream subsections

### Why it is bad
A close commit that updates README, milestone-header, timeline, and the docs pages — but leaves CLAUDE.md saying "Phase N has not started" and the milestone's per-workstream subsections still ticked `☐ Open` — produces a contradictory repository. The top of the milestone says "Complete"; the body says "Open". A reader picking either claim is reading something the close commit asserted.

Status sync is a property of every file that names the phase status, including:
- `README.md` status banner + table row
- `program_development/milestones/phase_NN_*.md` Status header **AND** every per-workstream `☐ Open` / `☑ Done` checkbox
- `program_development/timeline.md` (new entry)
- Every ADR Status field affected
- Every `module.yaml` / `tool.yaml` lifecycle field that flipped
- Every `docs_site/src/content/*.tsx` page-status banner that mentions the phase
- `CLAUDE.md` operational notes that name the phase status (`Phase-Specific Operational Notes` section)

### Required behavior
The pre-close grep must enumerate every file that mentions the phase identifier and confirm every reference agrees with the new status. This is broader than the previous "Aspirational documentation — status drift" pattern — it specifically calls out CLAUDE.md and per-workstream subsections, which are the two places the Phase 1 close missed.

```bash
grep -nrE "Phase 1" \
  README.md AGENTS.md CLAUDE.md \
  program_development/ \
  docs_site/src/content/ \
  apps/workbench-ui/src/
```

### Detection
- Pre-close grep above; every match must be consistent with the new status.
- Convention checker (future): a `scripts/dev/check_status_sync.sh` that fails if the same phase name has contradictory status text in different files.

---

## Error Pattern: Skipping the linter the repo rules require

### Why it is bad
AGENTS.md "Code Style and Module Boundaries" requires `ruff` clean, but the Phase 1 close shipped 28 ruff violations. The close ran pytest and the convention checker — both green — and called it done. Pytest doesn't catch unused imports, unsorted imports, line length, or `zip(strict=...)` requirements. The repo rule was just bypassed.

### Required behavior
Every commit that touches Python under `packages/core/src/`, `packages/physics_modules/`, or `tests/` runs `ruff check` (and `ruff format --check`) and only proceeds if both are clean. The required-tooling list is in AGENTS.md; agents do not get to pick which subset they run.

To make compliance easy, `scripts/test/all.sh` calls `scripts/test/lint.sh` (new, runs ruff) and a workstream's "tests pass" claim explicitly includes lint output.

### Detection
- `scripts/test/all.sh` runs ruff and exits non-zero on violations.
- Pre-commit grep (manual): `.venv/bin/python -m ruff check packages/core/src packages/physics_modules tests`.
- Code review: any "tests pass" claim in a commit message that didn't run ruff is incomplete.

---

## Error Pattern: Switching backends to make output "look better"

### Why it is bad
Backends are not interchangeable. Switching a CPU stiff-ODE simulation to a GPU explicit kernel changes physics fidelity, not just performance. Smoothed output may indicate the physics is actually wrong.

### Required behavior
Backend selection follows the criteria in plan §15.2 (problem size, stiffness, supported modules, reproducibility). Visual output quality is not one of the criteria.

### Detection
Review backend changes in PRs. Any backend switch that is justified by appearance rather than the §15.2 criteria is rejected.

---

## Error Pattern: Convention-checker existence ≠ phase-gate behavior

### Why it is bad
The convention checker enforces *that files exist*, not *that they do what the gate promises*. The Phase 2 close shipped with `scripts/dev/run_capsule.sh` still as the Phase-0 stub (`echo "Capsule loading is scheduled for Phase 2." && exit 2`). The checker's `check_file_executable` was happily green because the stub was executable. The Phase 2 gate says "portable, inspectable, **reloadable**, exportable" — and reload was broken. Same pattern hit `CapsuleCodeView.tsx`: the file existed, satisfied the checker, but its `getCapsuleFile(..., "src/generated/__index__")` call always returned 404, so the panel never rendered any source.

### Required behavior
Every gate criterion in the plan that names a *behavior* (reload, validate, export, render) must have at least one **behavioral test**, not just an existence assertion. Concretely:

- For each of the four "portable / inspectable / reloadable / exportable" promises in plan §Phase 2, there is one integration test in `tests/integration/` that exercises the user-facing flow (or a `tests/regression/` test if the bug already happened).
- For each UI deliverable that "shows X", there is one Vitest test that mounts the component, mocks the backend, and asserts the X is in the rendered output (not just that the component file exists).
- Documented script paths get a smoke test that runs the script with a typical input and asserts exit code 0 + recognizable stdout. The convention checker's `check_grep_absent_in_file 'scheduled for Phase' scripts/.../foo.sh` only catches the literal stub message; it does not prove the script does its job.

### Detection
- `grep -rn "scheduled for Phase" scripts/` should return only stubs in *not-yet-opened* phases, never in scripts the README or CLAUDE.md documents as a current entrypoint.
- Phase Gate Procedure: before flipping status, walk the gate criteria *as a user*, end-to-end, on a real capsule. The convention checker is a necessary condition, not a sufficient one.

### Bug log
- 2026-05-02 *Phase 2 false close — six legitimate review findings*

---

## Error Pattern: Building writers without wiring producers

### Why it is bad
Phase 2B shipped four provenance writers (`ProvenanceLock`, `write_environment`, `AgentTraceWriter`, `SourceRegistry`) and 21 unit tests for them. The unit tests proved each writer worked in isolation. But the *producer* — `save_capsule` — was never updated. It still wrote a Phase-1-style minimal `provenance.lock` (a hand-rolled TOML dict that didn't validate against `ProvenanceLock`), didn't write `environment.yaml`, and overwrote `agent_trace.md` instead of appending. So every saved capsule was missing a third of its Phase 2B contract; every fork inherited the bug; the validator (which didn't require `environment.yaml`) silently accepted the broken capsules.

### Required behavior
When a workstream introduces a writer/encoder/serializer, the same workstream wires it into every existing producer. The Definition of Done lists the producer call site by file:line. Concretely for Phase 2B:

- `save_capsule` calls `ProvenanceLock(...)` + `write_lock`, `write_environment`, and `AgentTraceWriter(...).append(...)`. No hand-rolled provenance writes.
- `fork_capsule` does the same and additionally records `parent_capsule_hash` from `SourceRegistry.aggregate_hash()`.
- An integration test asserts that a freshly-saved capsule's `provenance/provenance.lock` round-trips through `load_lock` (i.e. validates as a `ProvenanceLock`).

### Detection
- Grep for the writer's API in producer code: every Phase 2B writer must appear in `save_capsule` and `fork_capsule`. If a writer has only test imports, the wiring is missing.
- Grep for hand-rolled equivalents next to the import — `_write_toml`, `provenance = {...}`, `write_text(...).format(...)` near `provenance/` — those are the residue of the original producer that was never replaced.
- Round-trip test: a freshly-saved capsule's `provenance.lock` must `load_lock()` cleanly, and `environment.yaml` must `load_environment()` to a non-empty dict.

### Bug log
- 2026-05-02 *Phase 2 false close*: `save_capsule` wrote Phase-1 provenance triad, ignoring Phase 2B writers.

---

## Error Pattern: Schema drift between writers and validators

### Why it is bad
Phase 2A made HDF5 the canonical bulk-data format (ADR-0002 Accepted). `save_capsule` was updated to write `results/diagnostics.h5`. The `CapsuleValidator`'s `REQUIRED_FILES` was *not* updated — it still listed `results/diagnostics.json` as required and didn't mention `.h5` at all. Result: a capsule with the canonical HDF5 file but no JSON sidecar would fail validation; a capsule with neither would pass (because the JSON sidecar wasn't actually required either, after the deferred-update). Same drift hit `provenance/environment.yaml` — the writer existed, `save_capsule` (eventually) wrote it, but the validator didn't require it, so capsules with no environment snapshot validated clean.

### Required behavior
The validator's required-files / required-fields list mirrors the producer's outputs. When a workstream changes what gets written, the same workstream changes what gets validated, in the same commit. Concretely:

- Whenever `save_capsule` (or any other producer) gains a new output path, `CapsuleValidator.REQUIRED_FILES` (or `REQUIRED_SUBDIRS`) gains the corresponding entry.
- Whenever a producer changes a canonical format (e.g. JSON → HDF5), the validator's required entry changes alongside, and the old format moves to `RECOMMENDED_FILES` (warning) or is removed.
- The "freshly-saved capsule passes the validator" test (`test_validator_passes_on_freshly_saved_capsule`) is the canary — the producer + validator must agree, by construction.

### Detection
- One regression test per required artifact: delete the file, run the validator, assert non-OK with the expected violation code. The post-Phase-2-close audit added these for `results/diagnostics.h5` and `provenance/environment.yaml`.
- Code review: a commit that touches a producer's outputs must also touch the validator's required list. PR diffs that change one file and not the other are a flag.

### Bug log
- 2026-05-02 *Phase 2 false close*: validator required `diagnostics.json` (legacy), didn't require `diagnostics.h5` or `environment.yaml`.

---

## Error Pattern: Destructive-before-guard in exporters

### Why it is bad
The Phase 2C exporters did `if dest.exists(): shutil.rmtree(dest)` *before* checking whether `dest` overlapped with the source. Calling `export_capsule(capsule, capsule, kinds=("code",))` (a plausible UI-driven mistake — "export to my current capsule directory") would `rmtree(<capsule>/src/generated)`, *then* try to copytree from the now-empty source, and either succeed silently with empty output or fail mid-way with the source already mangled. Carries the deeper "Side-effecting before validating" pattern into export tooling specifically.

### Required behavior
Exporters validate the entire plan (workbench-target check, source/target overlap check, missing-source check) **before any destructive op**. Concretely:

```python
# 1. Walk the plan and validate.
plan = []
for sub in SUBDIRS:
    source = Path(capsule_dir) / sub
    if not source.is_dir():
        continue
    dest = Path(target) / sub
    refuse_if_outside_workbench(dest)
    refuse_if_overlaps_source(source, dest)   # ← key new check
    plan.append((source, dest))

# 2. Only now does the destructive loop run.
for source, dest in plan:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(source, dest)
```

The overlap guard refuses three cases: `dest == source`, `dest is an ancestor of source`, and (implicitly via `relative_to`) any path that would let `rmtree(dest)` walk into the source.

### Detection
- One test per exporter: `export_X(capsule, capsule, ...)` raises `ValueError` AND the source is still on disk afterwards. (The "still on disk" assertion is essential — a guard that raises after the rmtree is no guard at all.)
- Code review: `shutil.rmtree` (or `shutil.copytree(..., dirs_exist_ok=True)` with destructive semantics) must be preceded by validation that does not mutate filesystem.

### Bug log
- 2026-05-02 *Phase 2 false close*: `export_capsule(capsule, capsule, kinds=("code",))` deleted `<capsule>/src/generated` before raising.

---

## Error Pattern: Embedding absolute paths in exported artifacts

### Why it is bad
The Phase 2C notebook exporter wrote `capsule = Path('/Users/.../simulation_capsules/foo.lxp')` as a literal in the generated `analysis.ipynb`. The whole point of an export is to be portable across machines — an absolute path breaks that the moment the recipient unzips the export anywhere other than the original author's home directory. Same hazard applies to any exported config, README, or shell script that records a source location.

### Required behavior
Exported artifacts use relative paths, anchored to the export's own layout. The notebook's `CAPSULE_RESULTS = Path('..') / 'results'` works for the standard `<export>/notebooks/analysis.ipynb` layout; users who reorganize the export override the variable in one cell. README references inside an export use relative links. Shell scripts inside an export resolve relative to `${BASH_SOURCE[0]}`, never to the build machine's filesystem layout.

### Detection
- Test: assert `str(capsule.resolve())` is NOT a substring of any exported artifact (notebook source, README, etc.). The post-Phase-2-close audit added this assertion to `tests/unit/test_export_notebook.py`.
- Pre-commit grep on exporters: `/Users/`, `/home/`, or any absolute path outside of comments is suspicious in exporter code.

### Bug log
- 2026-05-02 *Phase 2 false close*: notebook exporter embedded the absolute capsule path.

---

## Error Pattern: Build script emits compile artifacts into the source tree

### Why it is bad
`apps/workbench-ui/package.json` had `"build": "tsc -b && vite build"`. When `tsc -b` failed (because some test files referenced `global` and `node:fs` without the right types), it had already emitted `.js` and `.d.ts` files next to every `.tsx` source. Those leaked into the source tree and were picked up as duplicate test files by Vitest (`App.test.js` running alongside `App.test.tsx`). They also stayed across runs — every subsequent build kept polluting more source.

### Required behavior
TypeScript's `tsc` runs in *typecheck-only* mode for production builds in this repo: `tsc --noEmit && vite build`. The bundler (Vite) is the only thing that emits bundles, and it emits to `dist/`. The tsconfig sets `"noEmit": true` as a belt-and-suspenders defense. Test files use vitest's `tsconfig` (or vitest's built-in TS handling) and never go through `tsc -b`. `.gitignore` carries a defensive rule for `apps/*/src/**/*.js` and `docs_site/src/**/*.js` so a stray `tsc -b` invocation can't accidentally commit emitted artifacts.

### Detection
- Pre-commit: `find apps/*/src docs_site/src -name '*.js' -o -name '*.d.ts'` should be empty.
- Build-script audit: any `tsc -b` invocation is a flag — use `tsc --noEmit` instead.
- Vitest output: if `*.test.js` and `*.test.tsx` both appear in the test-file count, the source tree is polluted.

### Bug log
- 2026-05-02 *Phase 2 false close*: `scripts/build/ui.sh` emitted `.js` files into `apps/workbench-ui/src/` and `docs_site/src/`; Vitest picked them up as duplicate test files.

---

## Error Pattern: Duplicated phase status across nearby paragraphs

### Why it is bad
README's status banner read "Phase 2 — Simulation Capsule System complete" at line 5; the status table at line 33 read "Phase 2 | In progress (2A, 2B, 2C, 2D open)". Both refer to the same phase, in the same file, twenty-eight lines apart. The status-flip commit updated the banner but not the table. Same pattern hits CLAUDE.md (multiple "Phase N — complete" paragraphs that drift independently) and `docs_site/src/content/*.tsx` (when the same phase is named in two pages).

### Required behavior
A phase's status string lives in one place per file when possible. When two places must mention it (e.g., README's narrative banner *and* the at-a-glance table), the status-flip commit's git diff includes both lines. The Phase Gate Procedure's status-sync grep is `grep -nE "Phase NN" README.md ...`, and the agent reads *every* match in the output, not just the first paragraph.

### Detection
- Pre-close grep: `grep -nE "Phase NN" README.md` should show every match agreeing with the new status. The agent reads all of them.
- Quick test: a regression test in `tests/regression/test_phase_status_consistency.py` greps the README + CLAUDE.md for forbidden status pairs (e.g. "Phase N — complete" anywhere AND "Phase N | In progress" elsewhere in the same file).

### Bug log
- 2026-05-02 *Phase 2 false close*: README:5 said "Phase 2 complete" while README:33 said "In progress".

---

## Error Pattern: Implementing the gate's verbs you can see, not the verbs the plan listed

### Why it is bad
The Phase 3 gate is "create a custom diagnostic tool, **test it**, document it, register it, **use it in an experiment**, and **export it**." (Plan §Phase 3, also restated in the milestone Phase Gate.) The Phase 3 close commit shipped *list*, *view docs*, and *update status* and called Phase 3 done. Five gate verbs (test, execute, import, export, use-in-experiment) had no implementation. The convention checker existed-checked the React component files; the existing UI test mocked `/api/tools` and `/api/tools/{name}` only; neither caught that "test it" / "execute it" / "import it" / "export it" / "use it in an experiment" had no code path at all.

This is a stronger, gate-specific form of *Implementing the agent's checklist instead of the plan's deliverable list*. The agent enumerated the entities visible in the *milestone hint* ("ToolList, ToolDetail, ToolDocs, ToolStatus") and built convention-checker assertions for them, then implemented exactly what the assertions covered. The plan's enumerated **verbs** got skipped because they didn't appear as file paths in the milestone hint.

### Required behavior
For every plan-stated **verb** in a phase gate, the close commit ships:

1. A backend endpoint or library function that performs the verb on a real artifact (not a stub, not a TODO comment).
2. A UI surface that lets a user trigger the verb (button, form, link).
3. An integration test under `tests/integration/test_phase_N_gate_walk.py` that exercises the verb end-to-end against a real fixture and asserts the user-observable result. Negative cases too — a "test it" verb must have a test that points at a deliberately failing test and asserts the failure surfaces.

The gate-walk file is the canonical name, mirrored across phases. Every phase that names verbs in its gate gets one. The convention checker's default branch checks the file exists; the test asserts the verbs work.

### Detection
- Read the plan's `## Phase Gate` paragraph for the phase. Extract every verb. Diff against the gate-walk integration test's `def test_phase_N_gate_walk_<verb>` functions. Missing verbs are missing implementation.
- Pre-close: `grep -E "POST /api/" packages/core/src/simworkbench/api/server.py` should cover every mutating gate verb. A gate that mentions "export" or "import" with only `GET` endpoints is incomplete.
- For UI verbs, open the relevant component and confirm there is a button or form for each verb. A panel that only renders metadata is read-only — it does not satisfy a verb gate.

### Bug log
- 2026-05-02 *Phase 3 false close — five legitimate review findings*: shipped read-only Tools tab with no execute / run-tests / import / export / use-in-experiment paths. The Phase 3 gate explicitly lists those verbs.

---

## Error Pattern: Path traversal via unvalidated user-controlled component in destination paths

### Why it is bad
A function that accepts a user-controlled name (`target_name`, `tool_name`, `capsule_name`, ...) and joins it onto a sandbox root must validate the resulting path BEFORE any side effect. Phase 3's `register_from_template(template_dir, target_name, target_root=...)` did:

```python
target = root / target_name             # `..` not refused
shutil.copytree(src, target)            # writes wherever target lands
```

A probe with `target_name="../../escape_probe"` created a directory outside the registry root before `is_under_workbench(root)` (which only validated `root` itself) had a chance to fire. This is the same pattern as path-escape in HTTP file servers — the guard validates the *root*, but the *resolved target* is what the OS actually opens.

### Required behavior
For any function that takes a user-controlled name and joins it to a sandbox root:

1. **Syntactic refusal** of obvious escape attempts BEFORE any filesystem touch — `..`, leading `..`, `/`, `\`, leading `.`, empty / whitespace-only names, absolute paths.
2. **Resolved-path check** with `target.resolve().relative_to(root.resolve())` to catch symlinks and platform-specific oddities the syntactic check misses.
3. Both checks happen before any `mkdir` / `copytree` / `unlink` / `write_text`.

Pattern (ToolRegistry):

```python
if "/" in target_name or "\\" in target_name:
    raise RegistryError(f"target_name {target_name!r} contains a path separator")
if target_name in {".", ".."} or target_name.startswith(".."):
    raise RegistryError(f"target_name {target_name!r} traverses the root")
target = (root / target_name).resolve()
target.relative_to(root.resolve())  # raises ValueError on escape
```

### Detection
- Test: pass a `target_name="../../escape"` and assert `register_from_template` raises BEFORE any directory leaks into the parent. The "before" matters — a guard that raises after the rmtree is no guard at all (cf. *Destructive-before-guard in exporters*).
- Code review: any `Path(root) / user_supplied` followed by `mkdir` / `copytree` / `write_text` without an intervening `.resolve().relative_to(root)` check is a flag.

### Bug log
- 2026-05-02 *Phase 3 false close*: `register_from_template` accepted `target_name="../../_phase3_escape_probe"` and created the directory before any name-shaped validation fired.

---

## Error Pattern: Cross-check on registered artifact that ignores half its identity

### Why it is bad
`ToolRegistry.register_from_template` rewrote `tool.yaml`'s `name:` to the user's chosen target_name but left `src/tool.py`'s `name = "TEMPLATE"` literal alone. Then `RegisteredTool.load_class()` cross-checked class.name vs metadata.name and rejected the mismatch. Result: every tool registered through the canonical template flow was unloadable. The cross-check was correct in spirit (catch divergence) but the *register* operation only updated half the identity; the *load* operation then rejected its own output.

This is the registration-side flavor of *Schema drift between writers and validators* (post-Phase-2-close pattern). The producer touched two artifacts that share an identity but updated only one; the validator then refused the inconsistency the producer just created.

### Required behavior
A registration / promotion / migration step that touches a tool's identity updates **every place that identity lives** in one operation. For Phase 3:

```python
# tool.yaml's `name:` field.
data["name"] = target_name
yaml.safe_dump(data, ...)
# AND src/tool.py's `name = "TEMPLATE"` literal — re-resolve via metadata.entrypoint.
entry_path = (target / metadata.entrypoint.split(":", 1)[0]).resolve()
entry_path.relative_to(target)   # path-escape guard
source = entry_path.read_text()
entry_path.write_text(source.replace('name = "TEMPLATE"', f'name = "{metadata.name}"'))
```

For other registries (capsules, modules), enumerate the identity fields once and update them together.

### Detection
- Integration test: register a template; immediately call `entry.load_class()`; assert `cls.name == target_name`.
- Code review: a `register_from_X` that writes one identity field but not the others is a flag. Diff against the consumer (the validator / loader / cross-check) — if the consumer reads N fields, the producer must write N.

### Bug log
- 2026-05-02 *Phase 3 false close*: registering the diagnostic template produced a non-loadable tool because the source class still had `name = "TEMPLATE"`.

---

## Error Pattern: Lifecycle promotion that checks the actor but not the artifact's scientific state

### Why it is bad
Plan §9.5 says a `validated` tool "Passes tests and benchmark cases". Phase 3's `set_status(name, ToolStatus.VALIDATED, actor="human")` only checked the **actor** (agent vs human) and the **state transition** (candidate → validated is allowed). It did not check whether the tool had any tests declared, let alone whether they passed. A candidate tool with `validation.tests: []` was happily promoted to `validated`. The lifecycle gate enforced who was allowed to flip the bit, not whether the bit corresponded to scientific truth.

This is the post-Phase-2-close *Schema drift between writers and validators* pattern applied to lifecycle: the registry stores `validated` as a label, but the criterion the label represents wasn't checked at the moment the label was written.

### Required behavior
Lifecycle promotion checks include the artifact's scientific state, not just the actor. For tools:

- `→ validated` requires (a) `validation.tests` is non-empty in `tool.yaml`, AND (b) every test in that list passes (the registry runs them via pytest before flipping the label).
- `→ trusted` requires the tool to already be `validated` (state transition rule), AND a recorded human review (actor=human is necessary but not sufficient — the API SHOULD eventually require an explicit reviewer identity recorded in provenance).

The same shape applies to physics-module promotions (`candidate → validated → trusted`) and to capsule format-version promotions (a manifest claiming `v0.2` is rejected if the v0.2 migration hasn't run successfully).

### Detection
- Test: declare `validation.tests: []` and assert promotion to `validated` raises `LifecycleError` with a message naming the empty list. Then point `validation.tests` at a deliberately-failing test and assert the registry runs it and refuses the promotion.
- Code review: a `set_status` / `promote` function whose body is one transition-rule check and one disk write — without any I/O against the artifact's evidence — is a flag.

### Bug log
- 2026-05-02 *Phase 3 false close*: a candidate tool with no tests was accepted as validated.

---

## Error Pattern: Validating inputs but not outputs at scientific boundaries

### Why it is bad
Phase 3A's `BaseTool` validated inputs through `inputs.require_array(...)` but `execute()` accepted whatever the subclass returned as long as it was a `ToolOutput`. A tool declaring `outputs: [peaks, peak_count]` could `return ToolOutput({"wrong": 1})` and the boundary said "fine". The first downstream consumer (UI, capsule writer, agent) would fail with a `KeyError` instead of a structured contract violation pointing at the offending tool.

Inputs and outputs are symmetric scientific boundaries. The reasons for refusing raw floats on the input side (units, shape, contract) apply just as forcefully on the output side: a tool that drops a declared port silently is a tool whose downstream consumers can't trust its declared contract.

### Required behavior
Every `tool.yaml`-driven boundary checks both directions:

- Input side: `BaseTool.execute` calls `validate_inputs` (already present).
- Output side: the registry-aware path (`RegisteredTool.execute`) walks `metadata.outputs` and asserts every declared port name appears in the returned `ToolOutput`. Extra keys are tolerated; missing keys are a `ToolRegistryError` with the missing list spelled out.

Direct `BaseTool().execute()` callers can opt into the output check by going through the registry, which is the canonical user-facing path.

### Detection
- Test: write a tool that deliberately drops a declared output and assert `RegisteredTool.execute()` raises with `missing declared` in the message.
- Code review: any `def execute()` that runs `validate_inputs` but not an `outputs` check at the same boundary is a flag.

### Bug log
- 2026-05-02 *Phase 3 false close*: a tool returning `{"wrong": 1}` while declaring `outputs: [peaks, peak_count]` was accepted.

---

## Error Pattern: Skipping workstream task bullets when the gate-verb walk seems satisfied

### Why it is bad
The post-Phase-3 ninth check ("gate-clause verb walk") covers the verbs in the plan's `## Phase Gate` paragraph. But each gate verb often expands into multiple **task bullets** under its workstream section. Phase 4's gate paragraph reads "a paper can be imported and converted into human-reviewable scientific interpretation artifacts." The agent satisfied the verbs (`import`, `extract`, `review`, `edit`). But Workstream 4A's task list expanded `import` into six bullets:

  1. Import PDFs.
  2. Store papers locally inside capsule.
  3. Extract text.
  4. Extract tables where possible.
  5. Extract figures metadata where possible.
  6. Preserve source files.

Only (2) and (6) shipped. Tasks (3)–(5) had no implementation; task (1) had no PDF entry point. The gate-walk integration test asserted the gate verb worked (`paper_imported.endswith("sample.md")` was true) — but it didn't assert each task bullet produced its own artifact. Since the verb seemed satisfied, the missing task bullets stayed invisible.

This is a stronger form of *Implementing the gate's verbs you can see, not the verbs the plan listed*. Ninth-check discipline gets you to the verb level; this pattern gets you to the task-bullet level.

### Required behavior
For every workstream NX, enumerate **every task bullet** in plan §Phase N / NX, not just the verbs in the gate paragraph. Each task bullet maps to:

- A separately-testable artifact (a file, a function, a flag, an HTTP response field).
- An assertion in `tests/integration/test_phase_N_gate_walk.py` (or a unit test in `tests/unit/test_workstream_<id>.py`).
- A line in the milestone Pre-gate verification list, ticked only when the artifact ships.

Concretely for Phase 4A: the gate walk asserts `extracted_text.md`, `extracted_tables.json`, `extracted_figures.json` each exist with non-trivial content from a fixture that exercises every bullet. The gate-walk test fails when ANY task bullet's artifact goes missing — not just when the verb fails.

### Detection
- Pre-close walk: open `scientific_simulation_workbench_agent_plan.md`, read the `### Workstream NX` section, copy the `Tasks:` bullet list to a checklist. Tick each bullet only when an artifact + test exists. Don't tick a bullet because "the gate verb works."
- Code review: a workstream PR that touches one entrypoint but the plan lists six task bullets is a flag. Diff the PR against the plan's bullet list explicitly.
- Test review: a `test_phase_N_gate_walk.py` whose assertions all pass against a stub-fixture that exercises only one task per verb is suspicious. The fixture should exercise every task bullet.

### Bug log
- 2026-05-03 *Phase 4 post-close audit*: PaperImporter copied + read-utf8 only; tasks 3–5 of Workstream 4A had no implementation (no `extracted_text.md`, no `extracted_tables.json`, no `extracted_figures.json`); PDF support task had no entry point.

---

## Error Pattern: Treating multi-target verbs as done when one target is implemented

### Why it is bad
A gate verb often applies to multiple targets — "Allow edits" applies to equations AND parameters AND interpretation; "Validate inputs" applies to every input port; "Promote tools" applies to every lifecycle transition. When the agent implements the verb for one target (or two), the verb feels complete; the test passes for the targets that exist; the missing targets stay silent.

Phase 4's `Allow edits` verb shipped for equations + parameters but not interpretation. The backend's `apply_edit` accepted `artifact="interpretation"`, but the UI's `InterpretationView` was read-only. A reviewer with no API access couldn't edit the assumptions document — so the gate verb's user-facing surface covered 2/3 of the targets while the gate-walk test stayed green.

This is the runtime sibling of the post-Phase-3 *Validating inputs but not outputs at scientific boundaries* pattern: partial coverage on one side of a symmetric contract.

### Required behavior
For every multi-target verb:

- Enumerate every target the verb applies to. For "Allow edits": every editable artifact kind. For "Promote tools": every lifecycle transition.
- The gate-walk test exercises the verb against **every** target, with one assertion per target. A negative case for at least one target.
- The UI surface includes a control for each target. A backend endpoint that accepts a target field but no UI surface for it is a flag.

Concretely for Phase 4: `test_phase_4_gate_walk_api_edit_interpretation_artifact` asserts the third target works end-to-end through the API; `InterpretationView` exposes an Edit button per Markdown section.

### Detection
- Code review: any verb whose backend takes a `kind` / `artifact` / `target` enum-like field deserves one UI control per enum value AND one test per enum value.
- Grep: a frontend component that renders content for N items but has fewer than N edit controls is a flag if the gate verb is "edit".
- Reviewer mental model: "if the user is offline-curling the API, can they exercise every target the verb claims to cover?"

### Bug log
- 2026-05-03 *Phase 4 post-close audit*: `InterpretationView` was read-only despite the backend supporting `artifact="interpretation"`; the verb felt complete because equations + parameters had edit controls.

---

## Error Pattern: Validating at the UI but not at the API boundary

### Why it is bad
The UI's `<input required>` / "reviewer name required" guard catches empty inputs in the workbench's React panel. But the backend's `POST /api/papers/{capsule}/edit` endpoint accepted `reviewer=""` cleanly and recorded `agent=reviewer:` in `provenance/agent_trace.md`. Other clients (curl, agents, scripts, future CLIs) bypass the UI entirely; the boundary they hit is the HTTP endpoint, and the HTTP endpoint trusted whatever the JSON body contained.

The audit trail this corrupts is the workbench's whole reason for existing. A capsule with provenance rows like `agent=reviewer:` is indistinguishable from a capsule with rows like `agent=reviewer:alice` until you read the entries — at which point you've already been misled.

This is *defense-in-depth missing at the system boundary*. The UI's validation is a UX nicety; the API's validation is the actual gate.

### Required behavior
Every API endpoint that accepts user-controlled input validates that input at the boundary, even when the UI also validates it. Concretely:

- Empty / whitespace-only required fields are rejected with 400.
- Path-shaped fields go through resolved-path checks (already covered by *Path traversal via unvalidated user-controlled component*).
- Enum-shaped fields are checked against the allowed set.
- Numeric fields are bounds-checked.

The library/SDK layer does the same — every public function called by the API also validates its inputs, so an agent calling `PaperImporter.apply_edit(reviewer="")` directly gets the same refusal.

### Detection
- For every `*Body(BaseModel)` in `simworkbench.api.server`, read the field types. If a string field can't be empty in a meaningful sense, the endpoint MUST reject empty/whitespace at the boundary. Pydantic `Field(min_length=1)` is the minimum; semantic checks (`reviewer.strip() != ""`) are stronger.
- Test: for every required-string field, send `""`, `" "`, `"\t"` and assert 400.
- Provenance review: greps like `grep -r "agent=reviewer:$" simulation_capsules/` should return zero rows. A trailing-colon entry is a corrupt audit trail.

### Bug log
- 2026-05-03 *Phase 4 post-close audit*: `POST /api/papers/{capsule}/edit` accepted `reviewer=""` and produced `agent=reviewer:` in `provenance/agent_trace.md`. UI blocked empty reviewer; API trusted the client.

---

## Error Pattern: Shipping the structured error without shipping the success path

### Why it is bad
The agent adds a clean entry point (`extract_text(pdf_path)`), drops in a structured exception when an optional dep is missing (`raise TextExtractionError("PDF text extraction requires pypdf...")`), and treats that as "feature support." Three things make the feature actually work, and only one was done in the Phase 4 close:

1. **The dependency is installed.** `pypdf` was missing from `packages/core/pyproject.toml` and from the venv. The success path could never run.
2. **The error propagates to the user.** The API endpoint caught only `PaperIngestionError`, not `TextExtractionError`. PDF imports returned HTTP 500 with an uncaught traceback — worse than the curated 400 the structured error was meant to produce.
3. **Tests exercise the success path.** The Phase 4 close had no test that imported a real PDF. A test that asserts the error fires when pypdf is monkey-patched out is the *failure*-path test; without a corresponding success-path test, "PDF support" is unfalsifiable from the test suite.

The pattern is subtler than "stub-as-complete" — the agent wrote real code, threw real exceptions with real messages, and felt like the work was done. But "support" means *the success path runs*, not *the failure path is polite*.

This is a generalization of the Phase 2 *Documented script that does not exist as an executable on disk* pattern: there a documented script existed but did nothing useful. Here a documented entry point exists and does nothing useful for the feature it claims to support.

### Required behavior
For every "supports X" claim — PDF parsing, HDF5 writing, GPU backends, optional features in general — the close commit verifies all three of:

1. **Dependency installed.** The dep is in `pyproject.toml` (`dependencies` for hard deps, `optional-dependencies` for opt-in features), AND `scripts/dev/install.sh` installs it, AND a test asserts `import <dep>` succeeds in the test venv. For features that *should* degrade gracefully when the dep is missing (e.g. headless matplotlib), the dep is in `optional-dependencies` and the docs say so explicitly.
2. **Error path reaches the user.** Every API endpoint / CLI entry point has a `try / except` that names the structured exception. A test posts an input that fires the error and asserts the documented status code (400 with the error's message, NOT a 500 traceback).
3. **Success-path test exists.** A test under `tests/integration/` or `tests/unit/` exercises the happy path with a real fixture. For binary formats (PDF, HDF5, openPMD) the fixture is the smallest valid file the format admits; we hand-roll it (Phase 4's PDF fixture is 600 bytes, generated by a deterministic Python script).

### Detection
- Pre-close grep: for every `raise <SomethingError>` in extractor / importer / backend code, find the corresponding `try / except` in `simworkbench.api.server` AND the corresponding success-path test. Three locations; all three must exist.
- Pre-close install probe: `.venv/bin/python -c "import pypdf, h5py, ..."` — every "supports X" claim must succeed in this list.
- Phase Gate Procedure check #11 (boundary validation parity) covers the failure path side; this pattern adds a **TWELFTH check**: every optional / heavy / dependency-backed feature has a happy-path test against a real fixture, AND its dep is installed by `scripts/dev/install.sh`.

### Bug log
- 2026-05-03 *Phase 4 post-close audit (round 2)*: PDF import returned HTTP 500 because (a) pypdf wasn't installed, (b) the API didn't catch `TextExtractionError`. The structured error was correct in principle but unreachable in practice; no PDF was ever successfully imported by the Phase 4 close.

---

## Error Pattern: Hard rule made optional via a client-controlled API parameter

### Why it is bad
Plan §Phase 4 says agent-only interpretation cannot feed Phase 5 ModelSpec generation — a hard rule, no exceptions. The Phase 5 close exposed a `require_reviewed: bool` field on `POST /api/proposals` (and a checkbox in the UI). Any client (curl, agent, scripted attacker) could send `{"require_reviewed": false}` and the rule was silently bypassed. A direct probe wrote `model_spec.yaml` and `experiment_proposal.md` from agent-only interpretation.

The pattern: a hard rule gets a `bypass: bool` knob, usually because tests or development workflows want the bypass. The knob travels from the library to the API to the UI, and nothing along the way questions whether the rule should still be optional at the system boundary. Clients trust client-supplied flags, hard rules become soft.

### Required behavior
Hard rules belong **inside** the function, not as a caller-controlled flag at the system boundary. Concretely:

- Library functions can take a `_for_tests=True` (or similarly clearly-scoped) keyword that bypasses the rule. The naming makes it clear the flag is not for production callers.
- Public API endpoints NEVER expose the flag. The endpoint hard-codes `require_reviewed=True` (or whatever the rule's positive form is); extra fields in the request body are silently ignored or rejected.
- UI controls follow the same rule: no checkbox or toggle for "skip the security check". The user has access to the library if they need a one-off bypass for development; the UI represents production behavior.
- A regression test sends the bypass attempt from outside the library and asserts the rule still fires. Negative test on the bypass field is the canary.

### Detection
- Pre-close grep: `grep -rn "require_reviewed\|bypass\|skip_check\|force\|override" packages/core/src/simworkbench/api/server.py` — any of these knobs on a request-body schema is a flag.
- Test review: every "soft option" knob on an API body must have a regression test that sends the negation and asserts the gate still fires (returns 4xx, persists no artifacts).
- Code review: a hard rule that admits a config flag is a strict-rule that's been silently downgraded. Question the flag.

### Bug log
- 2026-05-03 *Phase 5 post-close audit*: `POST /api/proposals` accepted `require_reviewed=false`; UI had a "Require reviewer signatures" checkbox; bypass wrote `model_spec.yaml` and `experiment_proposal.md` from agent-only interpretation.

---

## Error Pattern: Validating one input shape but not all input shapes the rule covers

### Why it is bad
The Phase 4 hard rule covers every interpretation artifact: equations, parameters, AND the four interpretation Markdown files (`paper_summary.md`, `assumptions.md`, `validity_domain.md`, `implementation_plan.md`). The Phase 5 generator's `_enforce_human_review` checked the structured rows (`edited_by` field on equations + parameters) but not the Markdown. A capsule with signed rows but Markdown still carrying the agent banner ("AGENT DRAFT — needs human review") was accepted, and a ModelSpec was written.

The pattern: a rule applies to an *artifact set* of mixed shapes (JSON rows + YAML rows + Markdown files), and the implementation spans only the shapes that already had structured fields. The rule was about whether the artifact had been reviewed; the check was about whether the rows had been signed. A reviewer who edited the rows but not the Markdown looked reviewed by the row-only check.

### Required behavior
A check that enforces a rule across a mixed-shape artifact set has one branch per shape:

- Structured rows: assert the per-row review field (`edited_by`, `reviewed_at`, etc.) is non-empty.
- Free-form Markdown / text: assert the agent's draft banner is no longer present (e.g. `"needs human review" not in body.lower()`). The banner is the agent's "I haven't been reviewed yet" signal; deleting or rewriting it is the reviewer's signature.
- Other shapes (binary, generated config) have their own per-shape review marker.

The check enumerates EVERY shape the rule covers, not just the easy-to-validate ones. A single regression test plants the unreviewed banner in a Markdown file and asserts the rule fires.

### Detection
- For every "is this artifact reviewed?" check, list the artifact shapes the rule covers. Diff against the check's branches. Missing shapes are the gap.
- Code review: a `_enforce_*` function that walks one container of one shape (`for row in rows:`) when the rule's prose says "every interpretation artifact" deserves a review-shape check.
- Banner grep: production capsules should NEVER carry the agent draft banner in artifacts that have crossed a review gate. A grep that finds the banner in a "reviewed" capsule is a leak.

### Bug log
- 2026-05-03 *Phase 5 post-close audit*: Phase 5 only checked `edited_by` on equations/parameters; capsule with signed rows + agent-banner Markdown was accepted as reviewed.

---

## Error Pattern: Compatibility checks that pattern-match instead of validating dimensionality

### Why it is bad
Phase 5B's `ModuleMatcher.unit_compat` returned 1.0 if every module-output unit was *parseable by pint* — regardless of whether the dimensionality matched the ModelSpec's needs. A fake module with a single output of dimension `[time]` (units: `second`) scored 1.0 against a species-domain ModelSpec whose canonical output is number density (`1 / [length]^3`). Parsing succeeds; compatibility doesn't.

Same pattern: a check that *something well-formed exists* gets confused with a check that *the right thing exists*. "Has any output" gets confused with "has the output the spec needs"; "every unit string parses" gets confused with "every unit dimension matches". The agent picks the easier check because it's easier to write.

### Required behavior
A compatibility check distinguishes *well-formedness* from *fitness for purpose*:

- Well-formedness: parses cleanly (units → pint, JSON → schema, etc.). Necessary but not sufficient.
- Fitness for purpose: the parsed value satisfies the consumer's contract. For unit compatibility: the dimensionality matches. For schema validation: every required field is populated AND the values are in-range.

Concretely for `ModuleMatcher`:

- `_required_output_dims(spec)` enumerates the dimensionalities the consumer (the runtime + ModelSpec) needs. For species-domain specs that's `1 / [length]^3` (number density).
- `unit_compat` is the fraction of *required* dims covered by some module output, NOT the fraction of module outputs that parse.
- A module that emits only `second` for a species-domain spec scores 0/1 = 0.0, not 1.0.

### Detection
- For every "compat" / "match" / "compatible" sub-score: write a fake-input test where the input is well-formed (parses, validates) but wrong-for-purpose. Assert the score is < 1.0.
- Code review: a check that runs `try / parse / except: return 0.0; else: return 1.0` is a well-formedness check, not a compatibility check. The compatibility check should compare the parsed thing to a target, not just succeed at parsing.

### Bug log
- 2026-05-03 *Phase 5 post-close audit*: a fake `rate_equation_0d` module outputting `second` scored `unit_compat=1.0` for a species-density ModelSpec.

---

## Error Pattern: Cross-cutting safety rule encoded in a comment but not enforced in code

### Why it is bad
`configs/agents.yaml` says::

    - role: security_sandbox
      description: Prevents unsafe file or execution behavior. Always-on once any agent is enabled.
      enabled: false

Across Phases 4 and 5 the workbench enabled `paper_ingestion`, `physics_interpretation`, `model_spec`, and `module_retrieval`. The "always-on once any agent is enabled" rule was prose; nothing read or enforced it. `security_sandbox.enabled` stayed `false`.

The pattern: a safety invariant is documented in a comment / description / docstring, but no code reads the comment. As phase work flips other rules, the safety rule drifts. The agent looks at the rule it's flipping and doesn't re-examine the rules cross-linked from it.

### Required behavior
A cross-cutting rule that says "X must hold whenever Y" needs:

1. A regression test that asserts the invariant. The test reads the relevant config / state / artifact and fails when X drifts from Y.
2. The rule's prose stays for human readers, but the test is the enforcement.
3. When the rule's scope changes (a new agent role, a new artifact type), the test fails until the rule is re-applied.

For `agents.yaml`'s always-on `security_sandbox`: `tests/regression/test_security_sandbox_enforcement.py` reads the YAML, computes `enabled - {security_sandbox}`, and fails if that set is non-empty while `security_sandbox` is disabled.

### Detection
- Grep for "always-on", "must be enabled", "always required", "always check" in config / docs / patterns. Each match needs a regression test that fails when the invariant drifts.
- Code review: a config field whose comment makes a cross-cutting claim and whose value doesn't reflect the current scope is a flag. The reviewer asks: what other state changed that should have triggered this?

### Bug log
- 2026-05-03 *Phase 5 post-close audit*: `security_sandbox.enabled = false` while `paper_ingestion`, `physics_interpretation`, `model_spec`, `module_retrieval` were all enabled — violated the "Always-on once any agent is enabled" rule that the role's own description carried.

---

## Error Pattern: Validation runs the source-of-truth, not the generated artifact

### Why it is bad
Phase 6's `ValidationRunner` was supposed to validate the generated `<capsule>/src/generated/experiment.py`. Instead it reloaded `model/model_spec.yaml` and ran the spec through the runtime, never importing or executing the generated file. Corrupting `experiment.py` with invalid Python returned `incomplete` with no failure: the corrupted artifact was silently skipped because validation didn't read it.

The pattern: a validation step is named after the artifact it validates ("ValidationRunner runs the generated experiment") but its implementation bypasses that artifact for the upstream source of truth. The artifact looks tested; it isn't.

### Required behavior
A "validate X" step must consume X. For executable artifacts: import them, execute them, surface failures. For declarative artifacts: parse them and assert structural identity with whatever the generator was supposed to emit. A failing or missing artifact must produce `failed` (not `incomplete`, not `passed`). Negative regression test: corrupt the artifact, run validation, assert `failed` + a non-empty `failure` field.

### Detection
- Grep for `Validat*Runner` / `validate_*` and check whether the body actually opens the artifact in question. If it loads a sibling file instead, the validation is bypassing.
- Negative test: corrupt the artifact and re-run validation; non-`failed` status is a bug.

### Bug log
- 2026-05-03 *Phase 6 post-close audit*: `ValidationRunner.run` skipped the generated `experiment.py` and ran `Runner` on the spec directly. A test that corrupted `experiment.py` got `validation_status: incomplete` instead of `failed`.

---

## Error Pattern: Validation rule fires after a permissive early-exit

### Why it is bad
Phase 1's `python_cpu` backend validated coefficient sources INSIDE a `for ix in spec.interactions` loop, but had a `if len(participants) < 2: continue` early-exit BEFORE the validation block. A one-participant interaction with a non-placeholder rate (e.g. `paper:k=1.0e7 1/s`) silently `continue`d — never raised, never produced any state change. The interaction looked like a no-op while the spec passed cleanly.

The pattern: validation lives downstream of an `if … continue / return / break`. Inputs the early-exit covers slip past validation. Phase 4's review banner check had the same shape (Markdown read but never inspected; only structured rows checked).

### Required behavior
Validate every input shape FIRST, then apply business / operational logic. The order is: (1) declarative checks the rule covers, (2) decisions that may skip work. Both branches of the skip carry the same validation cost. Negative regression test: send the input the early-exit covers and assert the validation still fires.

### Detection
- Grep for `continue` / `break` / `return` inside loops and audit whether the validators above could be moved below them. If so, the validation is conditional on the skip.
- Read every `for` loop in a validator: is there any path that exits without applying every rule?

### Bug log
- 2026-05-03 *Phase 6 post-close audit*: `python_cpu.RatePopulationBackend.initialize` had `if len(species_participants) < 2: continue` BEFORE the coefficient-source validation. One-participant interactions with non-placeholder coefficient_sources passed cleanly and produced unchanged state.

---

## Error Pattern: Trusting a client-supplied actor identity for a privileged check

### Why it is bad
`POST /api/tools/{name}/status` accepted `actor=human` from the request body and treated it as proof of human authorship. The library's `set_status` blocks `actor=agent` for human-only promotions but happily accepts `actor=human` from anyone, including the autonomous agent itself. Any caller (UI, agent, curl) could promote a tool to `validated` by claiming `actor=human`.

The pattern: a privileged check reads its actor from the request body. Without server-side authentication, the body is the agent. This is the network analogue of "Hard rule made optional via a client-controlled API parameter".

### Required behavior
Privileged checks derive the actor from server-side context (authenticated session, signed request, OS user). Until that infrastructure lands, the safe default is to require an out-of-band human-approval gate (config flag, file-based ack, prompt the user in the desktop app) — not to read the actor from the body.

A short-term fix that's still better than the trust default: refuse `actor=human` over plain HTTP and require a separate "approve" endpoint that consumes a human-approval token written by an out-of-band path.

### Detection
- Grep for `actor`, `user`, `role` request-body fields paired with privileged checks (`set_status`, lifecycle promotion, capability grants). Each match needs a server-side derivation, not a body read.
- Negative test: send `actor=human` from a context the server cannot authenticate; the privileged check must refuse.

### Bug log
- 2026-05-03 *Phase 6 post-close audit*: `set_tool_status(actor="human")` accepted from any caller, allowing agent-driven `candidate → validated` promotion via the API. The library blocked `actor=agent`; the API blocked nothing.

---

## Error Pattern: Diff endpoint that doesn't compute a diff

### Why it is bad
`GET /api/capsules/{name}/codegen/diff` returned `{previous: <old manifest>, current_files: <hashes of current tree>}`. The caller had to compute `(added, removed, changed)` themselves. Worse, the test that asserted the endpoint "reports regeneration changes" only checked that `previous` and `current_files` keys existed — never actually asserted any file appeared as changed. After mutating the spec, calling the endpoint, and not regenerating, the response contained zero diff signal because no regeneration had occurred.

The pattern: an endpoint named `diff` returns inputs to a diff, not the diff itself. The test asserts shape, not behavior. The reviewer reads the test name ("regeneration changes") and trusts the assertion ("keys exist"), even though the assertion is satisfied by an empty response.

### Required behavior
- An endpoint named after a transformation computes that transformation. `/diff` returns `{added, removed, changed, unchanged}`, each populated by a real comparison.
- A test that says "X reports changes" asserts at least one row appears in the changed list under conditions that should produce a change.
- Naming check: when the endpoint can't actually compute the named operation, rename it (`/state` instead of `/diff`).

### Detection
- Grep for endpoints whose name names a transformation (`/diff`, `/preview`, `/status-after-X`). Each must do the named work or be renamed.
- Read every test name: does the assertion actually exercise the verb in the name?

### Bug log
- 2026-05-03 *Phase 6 post-close audit*: `/api/capsules/{name}/codegen/diff` returned hashes only, no diff. Test `test_phase_6_gate_walk_diff_endpoint_reports_regeneration_changes` asserted only that two keys existed.

---

## Error Pattern: Archive contains its own destination

### Why it is bad
`export_archive` opened the destination zip file, then walked `capsule_path.rglob("*")`. When the destination was inside the source capsule (e.g. `<capsule>/exports/<capsule>.zip`), the in-flight zip captured itself. The user got an archive whose extract recursed.

The pattern: the exporter doesn't check whether the destination is reachable from the source's `rglob`. The "validate target before write" rule from earlier audits applied — but the rule only checked workbench-managed roots, not source/destination overlap.

### Required behavior
- Validate destination is OUTSIDE source root before opening the archive. If overlap is unavoidable, exclude the destination explicitly during the walk (`if path.resolve() == archive.resolve(): continue`).
- Regression test: call exporter with `target = capsule_path / "self-export.zip"` and assert the produced archive does NOT contain `self-export.zip`.

### Detection
- Grep for `rglob` / `iterdir` walks paired with `zipfile.ZipFile(...) as zf:` writes. If the archive is created before the walk and lives inside the walked tree, this pattern fires.
- Test: exporter called with destination inside source. Assert resulting archive's contents.

### Bug log
- 2026-05-03 *Phase 6 post-close audit*: `export_archive` opened `<capsule>/exports/<capsule>.zip` and then walked `<capsule>/`, including the in-flight zip in itself.

---

## Error Pattern: Serializer drops semantic fields when writing the canonical format

### Why it is bad
Phase 2A made HDF5 the canonical bulk format. The HDF5 metadata stored `placeholder_used: bool` (a flag) but discarded `placeholders: list[str]` (the names). The JSON sidecar carried the names but Phase 2D's validator marks JSON as warning-only — capsules can be HDF5-only. After save → load on an HDF5-only capsule, `placeholders` came back empty even though placeholders were used.

The pattern: when a writer ports from format A to canonical format B, semantic fields that B happens not to "look like" get downgraded or dropped. The reviewer compares the file count, not the field set. Reload silently loses signal.

### Required behavior
- Every save → load round-trip preserves the same set of semantic fields. Pick the canonical format's representation for each field and document it.
- Cross-format parity test: write a payload in canonical format only, read it back, assert every documented field matches the input.

### Detection
- Diff the writer's output vs. the data model's fields. Fields present in the model but absent from the canonical write are flag candidates.
- Round-trip test that uses the canonical format ONLY (no sidecar fallback).

### Bug log
- 2026-05-03 *Phase 6 post-close audit*: HDF5-only capsule reload returned `placeholders=[]` because `write_diagnostics_h5` stored only `placeholder_used: bool`.

---

## Error Pattern: Generator skips cleanup, leaving stale artifacts

### Why it is bad
Phase 6's `CodeGenerator` re-emitted into `<capsule>/src/generated/` without removing files the new run did not produce. After the spec lost a species, the old `diagnostics.py` references and stale test files lingered. Export bundled them. Reviewer saw a tree that didn't match the manifest.

The pattern: regenerate-in-place writers trust that "every file the new run cares about overwrites the old one". For files that the new run no longer produces, the old version persists.

### Required behavior
- Track the prior generation manifest. On regenerate, compute (prior - current) and remove the orphans before writing the new tree. Sandbox-checked, so user_edits/ stays untouched.
- Regression test: generate, mutate spec to drop an artifact, regenerate, assert the dropped artifact no longer exists.

### Detection
- Read every "regenerate" / "rewrite" / "refresh" code path. If it doesn't list-and-delete orphans, it leaks them.

### Bug log
- 2026-05-03 *Phase 6 post-close audit*: `CodeGenerator.generate` left old files under `src/generated/` because no cleanup pass ran.

---

## Error Pattern: UI calls itself an editor while shipping a viewer

### Why it is bad
Plan §Phase 6 / 6D names the deliverable "Generated Code Viewer **and Editor**" with the bullet "Allow user edits". The shipped UI listed files and offered Regenerate / View diff / Run validation buttons — no inline editing. The reviewer who needs to tweak `user_edits/run.py` had to leave the workbench, edit on disk, return.

The pattern: the plan's verb list ("view", "edit", "diff", "export") is treated as the menu of buttons rather than the menu of actions the panel must implement. The panel ships the buttons, calls the verbs done.

### Required behavior
- Word audit: every plan-named verb on a UI deliverable maps to a real interaction on the panel — a textarea for "edit", a real diff view for "diff", a download for "export".
- Test: each verb has a Vitest test that exercises the interaction (not just that the button exists).

### Detection
- Compare plan §Phase N / NX bullets against component test names. Verbs without matching tests are flag candidates.

### Bug log
- 2026-05-03 *Phase 6 post-close audit*: `GeneratedCodeView` had no editor. Plan §6D's "Allow user edits" bullet was unimplemented despite the convention checker passing.

---

## Error Pattern: Test gate runs unit tests but not the typechecker

### Why it is bad
Vitest transforms TypeScript via esbuild/swc, which strips types instead of checking them. A real type error — e.g. a UI component reading `diff.current_files` after the field was renamed to `diff.current_preview` — sails through `vitest run` without complaint. Convention checker is green, vitest is green, ruff is green; the build is broken.

The pattern: the repo's "test runner" suite (`scripts/test/all.sh`) runs unit / integration / regression / lint suites but doesn't invoke `tsc --noEmit`. A reviewer who runs `./scripts/test/all.sh` and then `npm --prefix apps/workbench-ui run typecheck` separately catches it; everyone else ships the bug.

### Required behavior
The repo's hard-gate test runner runs the typechecker. Specifically:

1. The TS package's `package.json` has a `typecheck` script: `tsc --noEmit`.
2. A `scripts/test/<lang>.sh` invokes that script. For this repo: `scripts/test/ui.sh` runs typecheck AND vitest, in that order.
3. `scripts/test/all.sh` calls the per-language script.
4. The convention checker asserts `scripts/test/<lang>.sh` exists + is executable.
5. When in CI: typecheck failures fail the gate, the same way ruff / pytest do.

### Detection
- Grep: `grep -rE "tsc --noEmit|typecheck" scripts/test/` — must hit a per-language test runner that's wired into `all.sh`.
- Cross-check the package's `package.json` `scripts.build` entry. If it includes `tsc --noEmit && …`, the build catches type drift; if `all.sh` ignores the build, the gate has the same gap.

### Bug log
- 2026-05-03 *Phase 6 post-close audit (round 2)*: `GeneratedCodeView.tsx` referenced `diff.current_files.length` after the API + TS type were renamed to `diff.current_preview`. `vitest run` passed; `npm --prefix apps/workbench-ui run typecheck` failed with TS2339. The repo's `scripts/test/all.sh` ran lint + unit + integration + regression + validation + performance but not the TS typechecker. Fix: new `scripts/test/ui.sh` that runs `tsc --noEmit` + vitest, wired into `all.sh`.

---

## Error Pattern: Lifecycle gate has a public bypass knob

### Why it is bad
A lifecycle mutator can look safe because the default path consumes an approval token and runs tests, while an optional parameter such as `consume_approval=False`, `skip_approval=True`, or `run_tests=False` lets direct callers bypass the gate. This recreates the same failure as trusting `actor="human"`: the code path that rewrites `module.yaml` or `tool.yaml` can still be called unsafely.

### Required behavior
The public mutator that changes lifecycle state must always enforce the gate. Test fixtures should create valid evidence and approval tokens, not add production bypass flags. If a lower-level helper exists for serialization tests, keep it private and ensure it does not share the production mutator name.

### Detection
- Inspect public lifecycle methods with `inspect.signature`; no `skip`, `bypass`, `consume_approval`, or `run_tests` parameter should exist.
- Negative regression: direct library call with `actor="human"` but no token must fail before any metadata write.

### Bug log
- 2026-05-04 *Phase 7 post-close audit*: `ModuleRegistry.set_status` initially moved approval/test enforcement into the library but still exposed `consume_approval` and `run_tests` flags. The fix removed both flags and added a regression that checks the public signature.

---

## Error Pattern: Registry discovery hides invalid metadata

### Why it is bad
If registry refresh catches every load error and skips the file, a malformed or invalid `module.yaml` disappears from the registry. A fresh registry then reports "module not found" instead of "module metadata invalid", which hides broken validated state and lets convention checks pass by absence.

### Required behavior
Registry discovery fails loudly on invalid `module.yaml` / `tool.yaml` and includes the file path in the error. Optional third-party quarantine can be added later, but first-party registry paths are part of the gate and must not be silently ignored.

### Detection
- Grep registry discovery for `except Exception: continue`.
- Regression: write `status: validated` with no benchmarks, instantiate the registry, and assert an invalid-metadata error is raised.

### Bug log
- 2026-05-04 *Phase 7 post-close audit*: after direct promotion wrote invalid validated metadata, `ModuleRegistry.refresh()` skipped the bad file and made the module vanish. Refresh now raises `ModuleRegistryError` with the path.

---

## Error Pattern: Plan-named module family collapsed into a reference subset

### Why it is bad
A phase can claim a family is complete after shipping one validated reference module while the plan named several sibling modules. Downstream matching then cannot find plan-promised modules, and the missing artifacts are easy to miss if the convention checker asserts only the reference implementation.

### Required behavior
Before closing a workstream, enumerate every module name from the plan and make the milestone and convention checker assert each completed deliverable. If validation is deferred, the module remains `candidate` and the deferral is explicit; the path still exists with module metadata, docs, source, tests, and examples.

### Detection
- Compare the plan's workstream module-name list against `packages/physics_modules/**/module.yaml`.
- Regression: exact plan-named paths must exist, and each declared test/benchmark path in module metadata must point at a real file.

### Bug log
- 2026-05-04 *Phase 7 post-close audit*: Phase 7B shipped `absorption_lambert_beer` and `rate_equation_0d` but lacked exact plan-named siblings including `laser/absorption`, `laser/emission`, `laser/excitation`, `laser/ionization`, `laser/recombination`, `species/electron_temperature`, and `species/species_density`.

---

## Error Pattern: Approval-token machinery built but not wired at the mutation boundary

### Why it is bad
Phase 6 / 7 / 8 each introduced a single-use approval-token flow (`grant_*_approval` + `consume_*_approval`) to gate human-only privileges (tool / module / backend promotions). The token reader is the actual gate; the writer is the user-facing CLI / Python helper.

The Phase-8 audit found `BackendRegistry.set_status` calling `require_backend_transition(actor=actor)` and rewriting the YAML — but **never calling `consume_backend_approval`**. The lifecycle module's actor check only refused `actor == "agent"`; passing `actor="human"` from any caller promoted the backend without a token. The token machinery existed; it just wasn't wired into the mutation point.

This is a sub-pattern of "Trusting a client-supplied actor identity for a privileged check": the bypass exists at the LIBRARY level (not just the API), because the library trusts an actor string instead of the token file.

### Required behavior
At every mutation boundary (`set_status`, `register_validated`, etc.) that promotes into a human-only state, **the library function consumes the approval token before any side-effect**. The lifecycle module's actor-string check is a defense-in-depth signal; the token consumption is the actual gate.

Concretely:
1. The mutation method takes `actor: str = "agent"` like before.
2. For human-only target states (validated / trusted), the method calls `consume_*_approval(name, from_status=..., to_status=...)`.
3. Token absence raises a structured `*ApprovalError`. The exception type is part of the public API so callers handle it explicitly.
4. The library exposes NO `skip_approval=True` / `skip_token=True` kwarg. A regression test inspects the function signature and fails if such a kwarg appears.

The token consumption is unconditional — even `actor="human"` doesn't bypass it. The lifecycle's actor check still fires (an agent cannot even *attempt* the promotion), but the token is what authorizes it.

### Detection
- Grep every `set_status` / lifecycle promotion method body for a `consume_*_approval` call. If the method writes the new status to disk without consuming a token first, the gate is missing.
- Negative regression test: write a token, call the mutation, verify the token file is gone afterwards (single-use).
- Negative regression test: do NOT write a token, call the mutation with `actor="human"`, assert it raises.

### Bug log
- 2026-05-04 *Phase 8 post-close audit*: `BackendRegistry.set_status` rewrote `configs/backends.yaml` after `require_backend_transition` but never called `consume_backend_approval`. Direct probe: `actor="human"` promoted `python_cpu` to `validated` without any token. Fix: `set_status` consumes the approval token whenever `new_status in {VALIDATED, TRUSTED}`.

---

## Error Pattern: Capsule writer reads single registry then silently defaults

### Why it is bad
A capsule writer needs to stamp metadata it cannot derive locally — for example, the determinism flag of the backend that produced the run. Phase 8 / 8D made `provenance.lock` carry a `determinism` field. The `save_capsule` writer read the flag from the runtime registry (auto-registered Python backends) and **silently defaulted to `True`** when the runtime didn't know the backend.

Backends that live in `configs/backends.yaml` but aren't auto-registered with the runtime — e.g. `cuda`, `external_pic` — never set the flag. A run on `cuda` saved the capsule with `determinism: true` and an empty warning, even though `configs/backends.yaml` declared `determinism: false` and ADR-0006 documents the policy.

The pattern: a writer consults ONE source of truth and silently defaults when that source doesn't know. When a different source DOES know (a YAML registry, a metadata file), the writer ignores it and stamps a comfortable lie.

### Required behavior
1. The writer consults sources in priority order until ONE returns an authoritative answer.
2. If NO source knows the value, the writer FAILS rather than stamping the safe-looking default. A failed save is recoverable; a wrong stamp on a saved capsule is not.
3. Each source is independent — runtime registry AND on-disk registry, not just one. The on-disk source survives across processes, agent restarts, and removed runtime imports.

For the determinism stamp specifically:
1. `simworkbench.runtime.get_backend(name)` — live `CAPABILITIES`.
2. `simworkbench.backends.BackendRegistry().get(name).metadata.determinism` — YAML-declared.
3. Else: `CapsuleSaveError`.

### Detection
- Grep `save_*` / `write_*` writers for `try: ... except: pass` blocks that hand-default a metadata value. Each is a flag.
- Round-trip test: save a capsule using a non-auto-registered backend, reload, assert the metadata field reflects the YAML declaration (not the comfortable default).

### Bug log
- 2026-05-04 *Phase 8 post-close audit*: `save_capsule` defaulted `determinism = True` and only read from the runtime registry. CUDA capsules saved with `determinism: true` despite `configs/backends.yaml` declaring `false`. Fix: `_resolve_backend_determinism` consults the runtime registry first, then `BackendRegistry`, and raises `CapsuleSaveError` when both fail.

---

## Error Pattern: Plain `str` field where a Literal/enum belongs

### Why it is bad
Pydantic `str` fields accept any string. When the field's *meaning* is one of a closed set of values (statuses, kinds, modes), the lack of enum / `Literal` typing means malformed values load silently and only fail later — usually deep in a downstream consumer that expected one of the closed values.

Phase 8 audit found `BackendMetadata.status: str` accepted `status: totally_invalid` from `configs/backends.yaml`. The failure surfaced only when `RegisteredBackend.status` evaluated `BackendStatus(self.metadata.status)`, hundreds of milliseconds and several call frames removed from the load.

This contradicts the "registry refuses invalid metadata" rule (rule 20).

### Required behavior
- Closed-set fields use `Literal[...]` typing or a Pydantic `Enum`. Pydantic refuses out-of-set values at validation time.
- The closed set is defined in ONE place — usually the matching enum (`BackendStatus`, `ToolStatus`, `ModuleStatus`, etc.). The metadata model imports from there or duplicates the literal tuple.
- Adding a new value happens in TWO places (the enum + the metadata literal). A mismatch is itself a bug; tests verify they agree.

### Detection
- Grep Pydantic models for fields whose *meaning* is a closed set but whose type is `str`. Each is a flag.
- Negative regression test: load a config with an unknown status / kind / mode value; assert the load raises.

### Bug log
- 2026-05-04 *Phase 8 post-close audit*: `BackendMetadata.status: str = "planned"` accepted any string. Fix: typed as `Literal["planned", "in_progress", "validated", "trusted", "deprecated"]`.

---

## Error Pattern: Recommendation ignores the configured selection policy

### Why it is bad
When a registry exposes a `recommend(spec)` method AND the corresponding YAML carries a `selection_policy` block, the two must agree. If the YAML says "auto selection filters to validated/trusted" and `recommend` returns every capability match (including `planned` and `in_progress` rows), the policy is documentation, not enforcement.

Phase 8 audit: `BackendRegistry.recommend(2D PDE)` returned `cpp (in_progress)`, `fortran (planned)`, `cuda (planned)`, `kokkos (planned)`, `petsc (planned)`, `amrex (planned)` even though `configs/backends.yaml`'s `selection_policy.ranking` documented filtering to validated/trusted. Auto-selection callers silently picked planned backends.

### Required behavior
- `recommend()` defaults to the policy the YAML documents. For backends, that's `{validated, trusted}`.
- An explicit override kwarg (e.g. `include_statuses=`) lets advanced callers widen the selection deliberately. The default keeps the safe behavior.
- A regression test compares the YAML's documented selection policy against the actual `recommend()` filter for the canonical spec.

### Detection
- Read the YAML's `selection_policy` block. Translate it into an assertion on `recommend()`'s default behavior. If the assertion doesn't fire today, the recommender is bypassing the policy.

### Bug log
- 2026-05-04 *Phase 8 post-close audit*: `BackendRegistry.recommend(spec)` returned every capability match regardless of status. Fix: default `include_statuses={VALIDATED, TRUSTED}`; explicit `frozenset()` widens the search.

---

## Error Pattern: External-writer functions skip the locality guard exporters got right

### Why it is bad
The workbench has documented locality rules: program artifacts go under `local_cache/`, `temp_imports/`, `temp_runs/`, or `simulation_capsules/` (the four allowed roots). External writes only happen via explicit export. The exporter pipeline (`export_capsule`, `export_archive`, etc.) enforces this with `is_under_workbench(target)` checks that refuse any other path.

Phase 8 added two new writer surfaces — `simworkbench.hpc.SlurmJob.write` and the `external_pic.StubPICAdapter` writers — that accept an arbitrary `target` argument and **don't apply the locality check**. The audit's direct probe wrote bundles + result files to `/private/tmp` by default.

The pattern: every writer function that accepts a path argument inherits the workbench's locality contract. New writers added in later phases re-introduce the leak unless the contract is enforced consistently.

### Required behavior
- Every writer that accepts a `target: str | Path` argument validates the resolved path with `is_under_workbench(target)` before any side-effect.
- An explicit `require_workbench_target: bool = True` kwarg lets callers opt out (mirrors `export_capsule`'s shape) for genuinely-external destinations chosen via the export menu.
- A regression test exercises the refusal path: pass `/tmp/...` as the target; assert `PermissionError("workbench-managed roots")`.

### Detection
- Grep new code for `target.mkdir(parents=True, exist_ok=True)` or `Path(target).write_text(...)` without a preceding `is_under_workbench` check. Each is a flag.

### Bug log
- 2026-05-04 *Phase 8 post-close audit*: `SlurmJob.write` and `StubPICAdapter.{write_input_deck, import_result}` wrote arbitrary paths. Fix: each gained a `require_workbench_target=True` default + the matching locality check.

---

## Error Pattern: Documented in-place mutation that silently copies on strided inputs

### Why it is bad
A function's docstring says "Mutates ``y`` in place and returns it." The implementation calls `np.ascontiguousarray(y)` to satisfy the C ABI requirement that `y` be a packed buffer. But `np.ascontiguousarray` returns a COPY when `y` is non-contiguous — and the function then mutates the copy, returns the copy, and the caller's original strided view is unchanged.

The Phase 8 axpy wrapper had this shape. The contiguous case worked correctly; the strided case silently produced a stale base array. Callers reading the docstring trusted the in-place claim; the failure mode only showed up when a caller passed a slice / view.

The pattern is broader than C ABI wrappers — anywhere a function "normalizes" an input through a copy-or-pass-through helper but the caller expects mutation, the contract leaks. NumPy's `np.ascontiguousarray`, pandas's `pd.to_numeric`, etc. all behave this way.

### Required behavior
- Functions advertising in-place mutation REFUSE non-contiguous (or otherwise non-mutable-friendly) inputs with a structured error. The error explains the contract: "make ``y`` contiguous on the caller side and re-assign". This makes the contract visible at call time.
- Alternatively, the docstring is rewritten to remove the in-place claim and describe the actual return semantics. Either way, the docstring and the runtime behavior agree.

### Detection
- Grep ctypes / C-ABI wrappers for `np.ascontiguousarray(<inout>)` patterns. Each is a flag if the wrapper documents in-place mutation.
- Negative regression test: pass a strided view as the in-place argument, assert ValueError ("contiguous").

### Bug log
- 2026-05-04 *Phase 8 post-close audit*: `cpp.axpy` advertised in-place mutation, normalized `y` through `np.ascontiguousarray`, silently copied non-contiguous `y`. Fix: explicit `flags.c_contiguous` check that raises ValueError with a clear remediation message.

---

## Error Pattern: Documentation claims behavior the code can't deliver

### Why it is bad
A docstring describes a behavior the implementation only partially achieves. The reader trusts the doc. The reader is misled.

Phase 8's Slurm bundle module described its output as "self-contained": the implication was a remote node could `sbatch <bundle>/submit.sh` and run, period. The actual implementation needs the workbench installed on the remote (via `pip install simworkbench-core` or `PYTHONPATH=...`); the bundle does not ship a wheel. The "self-contained" claim was true for *the workbench's payload + entrypoint* but false for *the runtime dependency*.

This is a sibling of "UI calls itself an editor while shipping a viewer" — but for module-level docstrings rather than UI deliverables.

### Required behavior
- Docstrings describe what the code actually does. Strong claims ("self-contained", "always reproducible", "atomic") get qualified or rephrased.
- A docstring lint pass at close time: read every module's top-level docstring and verify each claim is exercised by a test or carries a qualifier.

### Detection
- Look for adjectives like "self-contained", "atomic", "always", "guaranteed" in docstrings. Each carries a verification burden.
- A reviewer reading the module's top docstring should not be surprised by what they find inside.

### Bug log
- 2026-05-04 *Phase 8 post-close audit*: `simworkbench.hpc.slurm` claimed the bundle was "self-contained"; the runner explicitly required PYTHONPATH or installed package. Fix: docstring rewritten to describe the actual contract (payload + entrypoint self-contained; runtime dep must be installed on the remote node).

---

## Error Pattern: Stateful sampler whose history-clear races with engine pre-population on resume

### Why it is bad
An adaptive sampler exposes `_history` as the live ledger the engine populates between yields. The sampler's own `points()` generator calls `self._history.clear()` on entry "to reset between sweep runs". The engine, in its resume path, pre-populates `sampler._history` with the checkpoint's completed rows BEFORE calling `points()`. Result: `points()` clears the just-loaded history, the sampler sees an empty ledger, re-proposes the first point, the duplicate-skip filter consumes it without advancing, and the loop spins until killed.

This is a coupling bug: the engine and the sampler each think they own the reset/populate contract. Whichever runs second wins, and the order is non-obvious because `points()` is a generator — the body doesn't run until `next()` is called.

The pattern generalizes to any caller/callee pair where both write to a shared mutable attribute on entry. If the caller wants to pre-populate, the callee must NOT auto-clear, and the contract must be documented explicitly.

### Required behavior
- The engine owns the reset/restore contract. On every run it clears the sampler's history, then on a resume populates it from the checkpoint, BEFORE the sampler's iterator is advanced.
- The sampler's `points()` does NOT clear `_history`. The sampler may still inspect `_history` from `next_point` — it just doesn't manage the lifecycle.
- A safety counter (DUPLICATE_SKIP_LIMIT) wraps the loop so even a pathological adaptive sampler that re-proposes a duplicate forever stops with `stopped_reason="adaptive_stuck"` instead of hanging.
- Regression test: an adaptive sampler that always proposes the same point completes session 1, then resumes with the cap removed and stops with `stopped_reason="adaptive_stuck"` rather than spinning. A second test pre-populates history on resume and asserts the sampler sees prior rows on its first call.

### Detection
- For any class whose `__init__` initializes a list/set attribute the caller mutates, grep for `self.<attr>.clear()` in instance methods. Each is a flag.
- Trace the order of writes: if the engine writes before calling a callback that ALSO writes, the contract leaks.

### Bug log
- 2026-05-04 *Phase 9 post-close audit*: `AdaptiveSampler.points()` cleared `self._history` on entry, defeating `SweepEngine`'s resume pre-population. Adaptive sweeps that proposed already-completed points hung forever. Fix: removed `_history.clear()` from `points()`; engine clears + populates on every run; added `DUPLICATE_SKIP_LIMIT=100` safety counter that stops with `stopped_reason="adaptive_stuck"`.

---

## Error Pattern: New writer surfaces in a phase miss the locality guard the prior phase added

### Why it is bad
The repository has a load-bearing locality contract: program artifacts go under `local_cache/`, `temp_imports/`, `temp_runs/`, or `simulation_capsules/`. Phase 8 added the contract to `SlurmJob.write` and `StubPICAdapter` after an audit. Phase 9 introduced three new writers — `SweepEngine` (checkpoint), `SweepCheckpoint.save`, `ComparisonReport.write` — and none of them had the guard. A pytest sweep with `tmp_path` as the checkpoint dropped JSON outside the workbench root by default.

Each phase audit catches the leak, files the pattern, and the next phase re-introduces it on new surfaces because the rule lives in patterns/prose rather than a shared helper everyone has to call. The fix is mechanical (`if require_workbench_target and not is_under_workbench(target): raise`), and a regression test prevents regression on existing surfaces — but the rule needs to apply at the moment a new writer is INTRODUCED, not after.

### Required behavior
- Every new writer function or method that accepts a `target: str | Path` (or `checkpoint_path`, `output_dir`, etc.) ships with an `is_under_workbench` check and a `require_workbench_target: bool = True` kwarg in the SAME commit that introduces the writer.
- A regression test for each new writer verifies the refusal path with `/tmp/...` and the explicit-opt-out path with `require_workbench_target=False`.
- When a phase opens, sweep the new writer surfaces it adds and stage the locality test alongside the gate-walk test, BEFORE implementation begins.

### Detection
- Grep the diff for new functions or methods accepting `path | target | checkpoint_path | output_dir` parameters. Each that doesn't call `is_under_workbench` is a flag.
- A pre-commit pattern check: list every writer surface; each must appear in the corresponding regression test.

### Bug log
- 2026-05-04 *Phase 9 post-close audit*: `SweepEngine.__init__`, `SweepCheckpoint.save`, `ComparisonReport.write` all accepted external `target` paths without the workbench locality guard. Fix: each gained a `require_workbench_target=True` default + the matching `is_under_workbench` check; tests in `tests/regression/test_phase_9_audit_findings.py` enforce the refusal path.

---

## Error Pattern: Example writes to one path while the API endpoint reads from another

### Why it is bad
A phase ships an example script + an API endpoint that consumes the example's output. The example writes to `temp_runs/<name>/comparison/manifest.json`. The API endpoint reads `simulation_capsules/<name>.lxp/comparison/manifest.json`. The example produces a real artifact; the endpoint returns 404 forever. The UI's Comparisons tab is broken even though every individual unit test passes.

The pattern is a coupling bug between an example and a consumer. The example is "happy" because it succeeds locally and prints output. The consumer is "happy" because its tests use a fixture, not the example. Neither side notices the divergence until a user runs the example and clicks the UI panel that's supposed to render the result — by which time the trail of breadcrumbs spans temp_runs/, simulation_capsules/, an env var, and a docs page.

### Required behavior
- Examples that exist to feed a UI/API path write to the SAME location the consumer reads. Either the example writes to the consumer's path, or the consumer's path is configurable from the example's output dir.
- A regression test: the example writes its artifact, then the consumer (via TestClient or library call) reads it. If the test passes only with a hand-rolled fixture, the example/consumer link is unverified.
- The example's output messages tell the user how to view the result via the consumer ("View in UI: GET /api/comparison/<name>").

### Detection
- For every "feeds the UI/API" example, grep the example for `temp_runs_root` / `local_cache_root` / `simulation_capsules_root`. Compare with the consumer's read path. Mismatches are flags.

### Bug log
- 2026-05-04 *Phase 9 post-close audit*: `examples/parameter_sweep_quadratic/run_sweep.py` wrote to `temp_runs/<name>/comparison/`. The Comparisons UI's API endpoint read from `simulation_capsules/<name>.lxp/comparison/`. Fix: example writes to `simulation_capsules/<name>.lxp/comparison/`, prints the matching API URL, and a regression test asserts the round-trip.

---

## Error Pattern: Sentinel "best" returned alongside zero successful evaluations

### Why it is bad
An optimizer returns `OptimizationResult(best_parameters={}, best_value=inf, evaluations=N, rejected_by_constraints=N)` when every candidate was rejected by constraints. Downstream callers see `best_value=inf` and assume "the optimizer searched but found nothing better than infinity" rather than "the optimizer never executed the objective". The two cases are profoundly different — the second means a constraint set is impossible — but the result shape doesn't distinguish them.

`evaluations=N` (where N is the budget) further misleads: it implies "I evaluated N times and inf was the best", but no objective call ever happened. The cost of misinterpretation is downstream code that compares two infs and returns one of two empty parameter dicts as "the better optimizer".

### Required behavior
- When zero candidates pass the constraint filter, the optimizer returns `stopped_reason="all_candidates_rejected"`, `best_value=NaN`, and `evaluations=0`. The caller branches on `stopped_reason` first; the sentinel value is a backup signal.
- `evaluations` is the EXECUTED count only; rejected candidates are tracked separately in `rejected_by_constraints`. The sum is the budget cap, but the two are not interchangeable.
- A regression test constructs a problem with `constraints=lambda p: False`, asserts `evaluations=0`, `rejected_by_constraints=budget`, `stopped_reason="all_candidates_rejected"`.

### Detection
- Grep optimizer return statements for `evaluations=...` summing executed + rejected. Each is a flag.
- For every `best_value=inf | -inf | nan` path, verify a `stopped_reason` other than `"completed"` or `"budget_cap"` is set.

### Bug log
- 2026-05-04 *Phase 9 post-close audit*: `RandomSearchOptimizer.optimize` returned `evaluations=budget`, `best_value=inf`, `best_parameters={}` when every candidate was rejected. Fix: `evaluations` reflects executed only; all-rejected case sets `stopped_reason="all_candidates_rejected"` and `best_value=NaN`.

---

## Error Pattern: Callback-driven "early stop" that only labels the result, never terminates

### Why it is bad
An optimizer wrapper invokes a third-party search routine (`gp_minimize`, etc.) for the full budget and ONLY THEN checks the early-stop threshold against the final best value. If the threshold was crossed at iteration 3 of 100, the wrapper still ran 97 useless iterations. The caller paid the time cost; the result's `stopped_reason="early_stop"` label is doubly misleading because (a) the work wasn't actually stopped, just relabeled, and (b) the caller expects "early stop" to mean "fewer evaluations".

The pattern shows up whenever a wrapper around a fixed-iteration routine retrofits early-stopping at the result-inspection stage instead of using the routine's built-in callback.

### Required behavior
- Use the third-party routine's callback hook to terminate as soon as the threshold is met. `gp_minimize`'s `callback=` returns `True` to stop.
- Track the executed history inside the callback; compute `best_value` from the history rather than the surrogate's final state, since the surrogate's value may include a sign flip or a penalty.
- Regression test: a problem with a threshold the optimizer should hit early; assert `evaluations < budget`.

### Detection
- Grep optimizer wrappers for `result = gp_minimize(...)` followed by an early-stop comparison. If the comparison is post-call, it's labeling, not stopping.
- The wrapper's callback parameter must be wired to the threshold check.

### Bug log
- 2026-05-04 *Phase 9 post-close audit*: `BayesianOptimizerHook` ran the full budget then labeled the result `early_stop` if the threshold matched. Fix: wired `gp_minimize(callback=_early_stop_cb)` to terminate as soon as the executed history's best meets the threshold; `evaluations` reflects actual executed count.

---

## Error Pattern: Boundary validation lives at sample-time, not constructor-time

### Why it is bad
A `ParameterDistribution(kind="normal", params={"mean": 0.0, "stddev": -1.0})` constructs cleanly. The bad value reaches `rng.normal(loc=0, scale=-1, size=N)`, which raises a numpy-internal error far from where the user typed the value. Worse, `lognormal` with a similar bad stddev returns silent garbage in some numpy versions. The user's stack trace blames numpy; the actual fault is the user's input from 200 lines earlier.

The pattern: any data class that validates "at use time" rather than "at construction time" defers the error to the point where the trace is least useful. Pydantic validators, `__post_init__` hooks, and explicit pre-condition checks are the cure.

### Required behavior
- Every constructor / data class for user-facing input validates per-field constraints at construction (or at first use, with a clear error mentioning the original input).
- For `ParameterDistribution`: `normal`/`lognormal` require `stddev > 0`; `uniform` requires `low < high`. Each constraint raises `ValueError` from `sample()` (since the dataclass is frozen) with the offending value in the message.
- Bootstrap CI rejects `n_resamples <= 0`. Sensitivity analysis rejects empty distributions.
- Regression tests for each boundary; each test names the rejected value in the assertion.

### Detection
- For every dataclass / Pydantic model in `simworkbench.uncertainty`, list the per-field constraints documented in the docstring. Each is a missing validator.
- Negative test pass: construct each dataclass with an out-of-bounds value; assert `ValueError`.

### Bug log
- 2026-05-04 *Phase 9 post-close audit*: `ParameterDistribution` accepted `stddev <= 0` and `low >= high`; `bootstrap_confidence_interval` accepted `n_resamples <= 0`; `SensitivityAnalysis` accepted empty distributions. Fix: each constraint enforced at sample/construction time with a `ValueError` carrying the offending value.

---

## Error Pattern: UI banner / sidebar phase tag drifts behind the actual phase

### Why it is bad
The workbench UI's sidebar carries a phase-tag banner (`<p className="phase-tag">Phase 1F</p>`). It is read by every user. When the project ships Phase 9 and the banner still says Phase 1F, the user trusts the banner over the README. The tag becomes a small but persistent lie about what the program is.

The drift happens because the tag is a hard-coded literal in JSX rather than a value derived from a single source of truth (a phase constant in code or a config). Each phase the tag needs to be bumped in lockstep with `README.md`, the milestone file, the timeline, and the docs pages — and the JSX literal is the one most easily forgotten.

### Required behavior
- The phase-tag banner is bumped in the same commit that flips the phase status in `README.md` and the milestone file. Status-flip commits include the `App.tsx` (or equivalent) edit.
- A regression test parses `App.tsx` for `<p className="phase-tag">…</p>` and asserts the rendered text is not the pre-Phase-2 placeholder ("Phase 1F"). Future phases extend the assertion (or move to a derived phase constant).
- Long-term: replace the hard-coded literal with a constant imported from a `phases.ts` module that the convention checker can lint.

### Detection
- Grep `apps/workbench-ui/src/**/*.tsx` for `phase-tag` and confirm the rendered text matches the current phase's tag.
- Status-flip commits without an `App.tsx` change are flagged for review.

### Bug log
- 2026-05-04 *Phase 9 post-close audit*: `apps/workbench-ui/src/App.tsx` rendered `<p className="phase-tag">Phase 1F</p>` after Phase 9 closed. Fix: bumped to `Phase 9`; updated docstrings in adjacent components to remove "Phase 1F" from the headline; added regression test that parses the rendered tag.

---

## Error Pattern: Spec-level placeholder data not propagated through derived plan objects

### Why it is bad
A spec carries an explicit "this is exploratory / fabricated / TBD" marker on one of its fields (e.g. `interactions[*].coefficient_sources` entries prefixed with `"placeholder:"`). The runtime honors the marker — it refuses to silently use the placeholder rate. But a derived object — a plan, a summary, a manifest — that's supposed to surface "any placeholders present?" to a downstream caller never walks the spec's structure to extract them. The derived object is constructed with `placeholders=[]` by default; only an explicit setter (or test fixture) populates it. Real-world specs flow through with `placeholders=[]` and downstream "is this validated?" decisions return `validated`.

The pattern is a propagation gap: the marker exists in the source, the runtime respects it, but a sibling consumer that should also respect it doesn't. The test suite passes because the test fixtures use the explicit setter (`with_placeholder_coefficient(...)`), which DOES populate the field. The real-world callers that go through the spec → plan path never trigger the fixture.

### Required behavior
- For every flagged-data convention (placeholder markers, "needs human review" banners, units-missing flags), the producer of derived objects walks the spec's data structure and extracts the flag. The walk is in code, not behind a manual setter.
- Tests cover BOTH paths: the explicit setter (for ergonomics) AND the spec-level data path (for real-world fidelity). A test fixture that manually flags placeholders does not prove the spec-level path works.

### Detection
- Grep derived objects (plans, reports, manifests) for `placeholders=[]` / `flagged=set()` / `missing=()`. Each is a default that may never be populated by the real-world code path.
- Round-trip test: load a spec with a flag in the data; assert the derived object also carries the flag. If the test only flags via a setter, it's incomplete.

### Bug log
- 2026-05-04 *Phase 10 round-2 audit*: `ExperimentDesigner.design(spec)` returned `ExperimentPlan(placeholders=[])` even when `spec.interactions[*].coefficient_sources` carried `"placeholder:..."` entries. `capsule_status_for_plan(plan)` returned `validated` for every placeholder-backed real-world spec. Fix: `ExperimentDesigner._collect_placeholders` walks `spec.interactions` and surfaces every flagged interaction by name.

---

## Error Pattern: API endpoint claims provenance/inspectability but writes no trace

### Why it is bad
The plan's milestone Pre-gate lists "every autonomous decision is logged in `<capsule>/provenance/agent_trace.md`". The API endpoint that runs the autonomous decision returns 200 with the result, but never imports the trace writer. The trace silently doesn't get written. Any positive verification ("did the trace land?") was deferred to "later" and never wired in.

The accompanying regression test was a NEGATIVE assertion ("the reviewer doesn't touch off-limits trees") rather than a POSITIVE assertion ("the trace file exists with the right entry"). The negative test passed because the reviewer indeed didn't touch off-limits trees — the test's assertion didn't actually verify the positive plan-named requirement. The test name and docstring suggested coverage that the assertion didn't deliver.

### Required behavior
- Every endpoint that the plan declares "auditable" appends a structured row to the capsule's `provenance/agent_trace.md` with the agent role, action, files touched, and a notes field summarising the result.
- The regression test for the endpoint asserts the trace file EXISTS and CONTAINS the expected action name. Negative-assertion tests don't satisfy positive-claim plan items.
- A shared helper inside the API server is the canonical writer; endpoints can't accidentally emit a 200 without a trace because the helper IS the success path.

### Detection
- Grep the API server for endpoint handlers; for each, confirm a call to the trace writer in the success path.
- Read every regression test whose name promises a positive assertion; verify the assertion actually CHECKS the positive thing, not just that the negative didn't happen.

### Bug log
- 2026-05-04 *Phase 10 round-2 audit*: `POST /api/autonomy/{design,review,sweep}` returned 200 without writing any provenance trace. `tests/regression/test_autonomy_provenance_trail.py` only asserted negatives. Fix: new `_trace_autonomy()` helper wraps `AgentTraceWriter`; every endpoint calls it in the success path; new round-2 tests assert the trace file exists with the expected action name.

---

## Error Pattern: Mid-loop abort labeled but not enforced

### Why it is bad
An agent wraps a long-running loop (sweep engine, optimization, batch import) and is supposed to abort the loop early when some condition crosses a threshold (failure rate, cost ceiling, time budget). The implementation runs the FULL loop, then post-processes the report and sets `stopped_reason="aborted"` if the threshold was crossed. The user sees the label but the work was already done.

This is the same shape as the Phase 9 audit's `BayesianOptimizerHook` finding: callback-driven early-stop that only labeled the result, never terminated. The pattern keeps recurring because the wrapper treats the inner engine as a black box without a per-row hook.

### Required behavior
- The inner engine exposes a per-row / per-iteration observer hook whose return value (e.g. `True` to abort) actually stops the loop.
- The wrapper agent installs the observer in its `launch` / `run` and returns the (potentially partial) report with a specific `stopped_reason` distinguishing "abort cause" from "completion".
- Regression test: synthetic input that triggers the abort condition mid-loop; assert `len(report.runs) < spec.budget` AND `report.stopped_reason` is the specific abort cause.

### Detection
- Grep agent / wrapper classes for `engine.run()` followed by post-processing of `report.stopped_reason`. If the post-processing OVERWRITES the reason without proving the inner engine was stopped, that's a label.
- Look for `engine.run()` calls that finish before the wrapper's threshold is checked.

### Bug log
- 2026-05-04 *Phase 10 round-2 audit*: `ControlledSweepAgent.launch` ran the full capped sweep then relabeled `stopped_reason="high_failure_rate"`. Fix: `SweepEngine.__init__` gained an `on_row` callback; agent installs a per-row observer that actually aborts when failure ratio crosses the threshold (after a 4-run warm-up).

---

## Error Pattern: Each new phase re-introduces the locality leak on new writers

### Why it is bad
The workbench has a load-bearing locality contract: program artifacts under `local_cache/`, `temp_imports/`, `temp_runs/`, or `simulation_capsules/`. Phase 8 audit added the contract to `SlurmJob.write` and `StubPICAdapter`. Phase 9 audit added it to `SweepEngine`, `SweepCheckpoint.save`, `ComparisonReport.write`. Phase 10 introduced two new writers — `ScientificReviewer.write` and `ApprovalGate(state_dir=...)` — and BOTH shipped without the guard.

This is the third consecutive audit catching the same pattern on different writer surfaces. Each phase adds new writers; without a shared guard helper, the rule lives in `agent_error_patterns.md` prose and gets re-forgotten.

### Required behavior
- Every writer that accepts a `target | path | state_dir | output_dir` argument calls `is_under_workbench(target)` BEFORE creating the destination, with a `require_workbench_target: bool = True` opt-out kwarg.
- New writers ship with both the guard AND a regression test in the same commit that introduces them.
- Long-term: a shared helper (`require_workbench_target_or_raise(path)`) removes the per-writer copy/paste; the convention checker forbids new writer signatures that don't import it.

### Detection
- For every new writer surface (functions that take a `path` and write to disk), grep the file for `is_under_workbench`. Each that doesn't call it is a flag.
- A pre-commit pattern check: list every writer surface in the diff; each must appear in the corresponding regression test.

### Bug log
- 2026-05-04 *Phase 10 round-2 audit*: `ScientificReviewer.write(/private/tmp/...)` and `ApprovalGate(state_dir=/private/tmp/...)` accepted off-workbench targets. Fix: each gained `require_workbench_target=True` + `is_under_workbench` check; tests using `tmp_path` pass the explicit opt-out.

---

## Error Pattern: Hard-coded budget while YAML carries the documented cap

### Why it is bad
The repo has a config file (`configs/agents.yaml`, `configs/backends.yaml`, etc.) declaring a documented cap — e.g. `controlled_sweep.budget.max_evaluations_per_launch: 32`. The corresponding API endpoint hard-codes a different number (`budget=8`) inline. The YAML is documentation; the code is the actual enforcement. The two drift because nothing reads the YAML.

The risk is two-fold: (1) the YAML lies to anyone who reads it expecting it to govern the system; (2) bumping the YAML cap doesn't change the system's behavior, so an operator's intuitive "loosen the cap" workflow silently does nothing.

### Required behavior
- Every YAML config block that declares a numeric cap is READ by the code that enforces it. The code falls back to a documented default if the config is malformed / missing, but never silently promotes past the YAML.
- A regression test loads the YAML, extracts the cap, and asserts the API endpoint reports the same number (e.g. through a `"budget"` field in the response).

### Detection
- Grep API handlers + library entry points for numeric literals matching `budget=` / `max_=` / `cap=` / `limit=`. Each is a flag if the surrounding subsystem has a YAML config block declaring the same concept.
- Round-trip test: bump the YAML to a sentinel value; rerun the test; assert the response reflects the sentinel.

### Bug log
- 2026-05-04 *Phase 10 round-2 audit*: `POST /api/autonomy/sweep` hard-coded `budget=8` while `configs/agents.yaml` set `controlled_sweep.budget.max_evaluations_per_launch: 32`. Fix: new `_autonomy_sweep_budget()` helper reads the YAML; sweep response includes `budget` so callers can verify the cap.

---

## Error Pattern: Library/UI/docs claim N affordances while API ships fewer

### Why it is bad
The plan's deliverable list (or a docstring, or a UI panel comment) names N user-facing affordances — e.g. "drives the four autonomy endpoints (design / smoke / sweep / review)". The library has all N. The API ships fewer (only three handlers). The UI calls the missing endpoint and gets 404. The mismatch is hidden because:
  - Library tests exercise the agents directly, bypassing the API.
  - UI tests only verify the panel renders, not that buttons hit live endpoints.
  - Documentation describes the intended state, not the shipped state.

### Required behavior
- The plan's deliverable count == library agents == API handlers == UI buttons. A regression test enumerates each affordance and asserts every layer carries it.
- Word-by-word audit of plan deliverable descriptions: every named verb maps to a real API handler AND a real UI affordance AND an end-to-end test that exercises the full path.
- Docstrings that say "drives N endpoints" are accompanied by a test that loads N endpoints and asserts each returns a non-error status.

### Detection
- Grep UI components for "endpoints" / "actions" claims. For each claim, count the wired calls. Mismatches are flags.
- Diff API server handler list against library agent list. Misalignments are flags.

### Bug log
- 2026-05-04 *Phase 10 round-2 audit*: `AutonomyPanel.tsx` docstring claimed "drives the four autonomy endpoints (design / smoke / sweep / review)"; only three were wired. Fix: added `POST /api/autonomy/smoke/{name}` + `apiClient.smokeExperiment` + a "Smoke run" button in the panel with results section.

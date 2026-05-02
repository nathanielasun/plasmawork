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

## Error Pattern: Switching backends to make output "look better"

### Why it is bad
Backends are not interchangeable. Switching a CPU stiff-ODE simulation to a GPU explicit kernel changes physics fidelity, not just performance. Smoothed output may indicate the physics is actually wrong.

### Required behavior
Backend selection follows the criteria in plan §15.2 (problem size, stiffness, supported modules, reproducibility). Visual output quality is not one of the criteria.

### Detection
Review backend changes in PRs. Any backend switch that is justified by appearance rather than the §15.2 criteria is rejected.

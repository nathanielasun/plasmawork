# AGENTS.md — Operating Instructions for All Development Agents

This file is the canonical instruction set for autonomous and semi-autonomous coding, review, and documentation agents working in the **Scientific Simulation Workbench** repository. The full architectural design is in `scientific_simulation_workbench_agent_plan.md`. This file distills the durable rules that survive across phases.

`CLAUDE.md` duplicates these rules and adds operational specifics for Claude Code.

---

## Mandatory Repository Rules for Development Agents

1. **Documentation stays synchronized with code.** If behavior, configuration, APIs, simulation modules, build instructions, or capsule format change, update the relevant page in `docs_site/src/content/` and `README.md` *before* completing the task.

2. **Maintain program documentation inside `docs_site/`** as TypeScript/MDX-compatible pages accessible from the workbench UI. Do not duplicate documentation strings into the UI source — load from the canonical docs.

3. **Maintain a root-level `README.md`** with build instructions, installation instructions, repository structure, development workflow, testing commands, and update procedures.

4. **Maintain `.gitignore`** so local cache directories, temporary simulation files, intermediate paper imports, generated run outputs, and local environment files are never committed.

5. **Keep temporary files local to the program installation directory.** Do not write program artifacts into arbitrary user directories. The allowed local-only roots are:
   - `local_cache/`
   - `temp_imports/`
   - `temp_runs/`
   - `simulation_capsules/`

   External writes (export of code, data, or report) only occur when the user explicitly exports a capsule.

6. **Maintain `bugs_and_fixes/`** with:
   - `program.log.example` (template — actual `*.log` files are ignored)
   - `bugfixes.md`
   - `known_failures.md`
   - `regression_tests.md`
   - `agent_error_patterns.md`

7. **Before modifying code related to an existing subsystem, inspect `bugs_and_fixes/`** for relevant historical bugs. Do not reintroduce known errors. If you fix a bug, log it in `bugfixes.md` and add or link a regression test.

8. **Maintain `program_development/`** with implementation timeline, development history, architectural decision records, and milestone phase notes.

9. **Generated scientific simulations must be inspectable, editable, modular, exportable, and reloadable**, and must be tied to explicit assumptions, units, parameters, and validation checks.

10. **Prefer precise validated modules over broad approximations.** Fast nonsense is still nonsense. If a coefficient or sub-model is missing, mark the run `exploratory` and surface the gap — do not silently invent values.

11. **The convention checker is the source of truth for phase completion.** A phase is complete only when `scripts/dev/check_repo_conventions.sh` exits zero against every deliverable named by the plan, the README, and the relevant milestone file. Markdown checkboxes are aspirational; the checker is enforced. See **Phase Gate Discipline** below.

12. **Documented commands must exist as executables.** Every script path mentioned in `README.md`, `CLAUDE.md`, `AGENTS.md`, or any docs page must be present on disk and executable, even before its subsystem is implemented. Use stubs that print "Phase N — not implemented yet" for unimplemented commands. A docs reference and the corresponding stub land in the same commit.

13. **Reality-test plan-derived artifacts.** The plan document is design, not implementation. Patterns copied from it (`.gitignore` rules, directory diagrams, filename templates, command lists) get reality-tested against the actual filesystem before commit — see `bugs_and_fixes/agent_error_patterns.md` "Treating the plan document as a check instead of as a draft".

14. **The plan's workstream description is the deliverable list — milestone Pre-gate hints are illustrative, never substitutive.** Before claiming a workstream done, enumerate every named class, file, module, script, config key, ADR, and test from `scientific_simulation_workbench_agent_plan.md` `§Phase N → Workstream NX` and confirm each is asserted in the convention checker and exists on disk. If the milestone Pre-gate hints disagree with the plan, the plan wins and the milestone is patched first. See `bugs_and_fixes/agent_error_patterns.md` "Implementing the agent's checklist instead of the plan's deliverable list".

---

## Repository Architecture Rules

- **Languages**: Python for core/runtime/physics (`packages/core`, `packages/physics_modules`, `packages/solver_backends`); TypeScript for UI (`apps/workbench-ui`) and docs (`docs_site/`).
- **Packaging boundary**: a Python package and a TS package never import each other directly. They communicate via the documented HTTP/IPC API in `packages/core/.../api/`.
- **Module SDK**: physics modules and internal tools live under `packages/physics_modules/<domain>/<name>/` and `packages/internal_tools/registry/<name>/` respectively, each with `module.yaml` or `tool.yaml`, `src/`, `tests/`, `docs/`, `examples/`, `README.md`, `changelog.md`.
- **Capsules**: simulation outputs are isolated inside `.lxp/` capsule directories (see plan §7). Generated code lives in `<capsule>/src/generated/`; user-edited code in `<capsule>/src/user_edits/`. Agents never overwrite `user_edits/` silently.
- **No circular imports across phase boundaries.** The dependency direction is: `physics_modules → core`, `solver_backends → core`, `agent_orchestration → core`, `apps/workbench-ui → core` (via API), `docs_site` is standalone.

---

## Required Documentation Practices

- Every behavioral change updates the matching docs page (see plan §4.2 for the page list).
- Every new physics module and internal tool ships with a `README.md`, `assumptions.md` (or equivalent inline doc), input/output units, validity domain, at least one test, and at least one example.
- Every public Python function gets a docstring stating: purpose, inputs (with units), outputs (with units), assumptions, references.
- Every TypeScript public API gets a TSDoc block.

---

## Required Testing Practices

- New code lands with tests. The test layout is: `tests/{unit,integration,regression,validation,performance}`.
- Every bug fix adds or updates a regression test where feasible, linked from `bugs_and_fixes/bugfixes.md`.
- Validation tests assert scientific properties (dimensions, conservation, analytical limits, convergence, benchmark reproduction). Performance tests must not silently relax correctness tolerances.
- **Test fixtures are deep-copied when mutated.** A module-level dict like `MINIMAL_SPEC = {...}` is shared across tests. Any test that derives a variant must use `copy.deepcopy(FIXTURE)` — never `dict(FIXTURE)`, `{**FIXTURE}`, `FIXTURE.copy()`, or list-slice copies — because those leave nested lists/dicts shared, and the next test inherits the pollution. Better: factory functions or `pytest.fixture` with `scope="function"`. See `bugs_and_fixes/agent_error_patterns.md` "Shallow-copying a mutable test fixture".
- **Test wrappers prefer the repo virtualenv.** `scripts/test/*.sh` resolve a Python interpreter in the order `SIMWORKBENCH_PYTHON` → `.venv/bin/python` → bare `python`. Tests must run from a clean shell without manual `source .venv/bin/activate`.

---

## Code Style and Module Boundaries

- Python: type hints on all public APIs; `ruff` clean; explicit error handling at boundaries; no bare `except`.
- TypeScript: strict `tsconfig`; no `any` in exported types.
- Units are first-class. No raw floats for physical quantities crossing module boundaries — use the units subsystem (`packages/core/src/simworkbench/units/`).
- Flexible `dict[str, Any]` fields at scientific boundaries (`fields.initialization`, `interactions.valid_regime`, etc.) require recursive validation that rejects raw numbers and unitless numeric strings. See `bugs_and_fixes/agent_error_patterns.md` "Letting `dict[str, Any]` bypass scientific boundary validation".
- Cached singletons use `@functools.lru_cache(maxsize=1)` on a factory function, not `global` declarations on module-level mutable state. See `bugs_and_fixes/agent_error_patterns.md` "Module-level mutable state for cached singletons".
- Module boundaries are enforced by the registry. New cross-module coupling requires an ADR in `program_development/architectural_decisions/`.

---

## Bug Memory and Regression Prevention

- Before editing a subsystem, `grep` the relevant subsystem path inside `bugs_and_fixes/` to check for prior bugs.
- After fixing a bug, append to `bugfixes.md` using the template in plan §5.1 (date, subsystem, symptoms, root cause, fix, regression protection, agent warning).
- Patterns of repeated agent mistakes go in `agent_error_patterns.md`.

---

## Safety Limits for Generated Scientific Code

- Generated code must declare its assumptions, units, validity regime, and source paper.
- Generated code never replaces a validated solver call with a naive timestep loop without an explicit ADR.
- Generated coefficients must be sourced. Missing data is reported, never fabricated.
- Generated code is placed inside a capsule sandbox (`<capsule>/src/generated/`). Promotion to a registry module requires validation evidence and human approval.

---

## Adding Internal Tools and Simulation Modules

- Use the templates in `packages/internal_tools/templates/` and `packages/physics_modules/templates/`.
- Lifecycle: `draft → candidate → validated → trusted → deprecated`. Agents may create `draft` and `candidate` only. Promotion to `trusted` requires a human reviewer.
- Promotion criteria are in plan §14.3.

---

## File Locality

- Imported papers, datasets, and tools are copied into local project-controlled directories before use:
  - papers → `temp_imports/papers/` then capsule `paper_sources/`
  - imported tools → `local_cache/imported_tools/`
  - run artifacts → `temp_runs/<run_id>/` and the owning capsule
- Agents must not write outside these roots without an explicit export step initiated by the user.

---

## Program Development History

- Major implementation work appends an entry to `program_development/timeline.md` (date, completed, changed, open questions, next steps).
- Architectural decisions get an ADR (see plan §6.2) numbered sequentially in `program_development/architectural_decisions/`.
- Milestone phase completions update `program_development/milestones/phase_NN_*.md`.

---

## Explicit Warnings Against Reproducing Already-Fixed Bugs

- The most common agent failure is removing a defensive check or rewriting validated code with a "simpler" version that loses an invariant. Read the surrounding tests and `bugs_and_fixes/bugfixes.md` first.
- Do not "clean up" or "simplify" code in `validated`/`trusted` modules without an ADR.
- Do not change tolerances in validation tests to make them pass. Investigate the root cause.
- Do not switch backends to make a number look better. Backend choice never silently changes physics.

---

## Phase Gate Discipline

Phase 0 was initially marked complete with stale README status, missing package manifests, missing milestone files, and missing documented scripts. The bug is logged in `bugs_and_fixes/bugfixes.md` (2026-05-02 — *Phase 0 gate false positive*). The rules below exist so that mistake does not recur.

### A phase gate has three independent checks

A phase is genuinely complete only when **all three** of the following are true:

1. **Convention checker is green.** `scripts/dev/check_repo_conventions.sh` exits zero. Every plan-named deliverable, every documented command path, every milestone filename, and every package entrypoint has a corresponding assertion.
2. **Status is synchronized everywhere.** The phase status reads identically in `README.md`, `program_development/milestones/phase_NN_*.md`, and `program_development/timeline.md`. (Add: any ADR Status field, any `module.yaml` / `tool.yaml` lifecycle field, any `docs_site/src/content/*.tsx` page that names the status.) Status flips happen in **one commit** that touches every place the status is mirrored.
3. **Deliverables-to-checker mapping is complete.** Every deliverable listed in the milestone file's Phase Gate, the relevant plan section, and the `README.md` status table has at least one assertion in the convention checker. Hand-tracking deliverables in markdown is not enough — they get translated into checks before the gate is claimed.

### When starting a phase

The first action of any agent opening a new phase is to extend the convention checker:

1. Read the plan section for that phase, the milestone file, and the README sections it touches.
2. List every deliverable: package manifests, source entrypoints, documented commands, configs, ADRs, milestone files, docs pages, examples, tests.
3. For each deliverable, add an assertion to `scripts/dev/check_repo_conventions.sh` (file exists, executable, contains required pattern, does not collide with `.gitignore`, etc.).
4. The checker fails after this step — that is correct. The failures are the work to do.
5. Implement the work. The checker passes when the phase is genuinely complete.

### When starting a workstream

A workstream is the smallest unit a phase can claim "done" against. The Phase 1A bug came from declaring Workstream 1A done after implementing only one of its six named classes — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 1A/1B gate overstated implementation completeness*. To prevent recurrence:

1. Open `scientific_simulation_workbench_agent_plan.md` and locate `## Phase N` → `### Workstream NX:`. Read the entire bullet list.
2. Enumerate every named entity — every class name, file path, config key, script, ADR, test, and example. Treat each as one row of the deliverable table.
3. Cross-check against the milestone's `Pre-gate verification → Convention-checker assertions to add` list. If the milestone is missing an entity from the plan, **update the milestone first** in a single small commit before any code lands. The milestone hints must reflect the plan's deliverable list, not the agent's mental model.
4. For every entity, add or extend a `scripts/dev/check_repo_conventions.sh` assertion. Prefer one assertion per named entity rather than one assertion for the whole directory.
5. Run the checker — it should fail loudly with one failure per missing entity. Implement until each one is green.
6. Workstream done = every plan-named entity has a green assertion AND a unit test (or an explicitly-deferred-to-named-followup with a checker assertion that fails until resolved).

This sequence is mandatory. The illustrative starting-point hints in the milestone Pre-gate sections are exactly that — starting points. They cannot replace the plan's enumerated workstream description.

### When closing a phase

Before flipping any phase status to "Complete":

1. Run `scripts/dev/check_repo_conventions.sh` and confirm zero failures.
2. Run any subsystem tests relevant to the phase.
3. Audit status references with a single grep:
   ```bash
   grep -nE "Phase NN" README.md program_development/milestones/phase_NN_*.md program_development/timeline.md
   ```
   Confirm every match agrees with the new status.
4. Commit the status flip in one commit that touches all status-bearing files at once.
5. Push (this is a major change per **Autonomous Git Operations**).

### When a checker assertion is wrong

The checker can be wrong (e.g. asserts a file that the plan no longer wants). When you discover this, fix the **assertion** — do not mark the phase complete by removing the failing check. Removing a check to silence a failure is the same category of mistake as lowering a validation tolerance. If the plan and the checker genuinely disagree, file an ADR before changing either.

### Aspirational documentation is forbidden

A "complete" status anywhere in the repository asserts that the artifacts described actually exist. If you find a file claiming completion that the artifacts do not support, the file is wrong — fix it, and log the drift in `bugs_and_fixes/bugfixes.md` so future agents see the precedent.

---

## Autonomous Git Operations

Agents working in this repository are **authorized to commit and push without per-action user approval**, subject to the rules below. This is a durable authorization recorded here in `AGENTS.md` and in `CLAUDE.md` — it overrides the default "always ask before pushing" behavior of coding-agent harnesses *for this repository only*.

### What agents must do

After completing a meaningful unit of work, agents commit. After a *major* change, they also push to `origin` on the current branch.

A change is **major** — and warrants an immediate push — if any of the following are true:

- A workstream within a phase is completed (e.g. "Phase 0 / Workstream 0B done").
- A phase gate is passed.
- A bug is fixed and logged in `bugs_and_fixes/bugfixes.md`.
- A module or tool transitions status (`draft → candidate → validated → trusted → deprecated`).
- An ADR is added, accepted, deprecated, or superseded.
- The diff spans more than three files of meaningful change, or crosses subsystem boundaries.
- A milestone file or `program_development/timeline.md` entry is added.
- A user-visible feature is shipped or removed.

Routine tweaks (typo fixes, single-file polish, in-progress edits) commit but do not necessarily push immediately — batch them under the next major push so the remote history remains a useful changelog.

### What agents must not do without explicit user approval

- Force-push of any kind (`--force`, `--force-with-lease`) to any branch.
- Destructive rewrites of published history (interactive rebase that drops or edits commits already on `origin`).
- Skipping hooks (`--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`).
- Committing files that might contain secrets — `.env`, `*.local.yaml`, credential files, API keys, service-account JSON. If such a file appears in the diff, stop and surface it.
- Committing tracked artifacts the convention checker forbids (logs, simulation outputs, capsule contents).
- Deleting branches (`-D`, `-d`) other than transient agent-created branches the agent itself created in the same session.
- Pushing to a branch other than the current branch's tracked upstream.
- Creating, closing, or commenting on PRs, issues, or releases — these are user actions.
- `git reset --hard`, `git checkout --` of files with uncommitted user work, or any operation that throws away work without it being recoverable.

### Commit and push hygiene

- Stage specific files by path. Never use `git add -A` or `git add .` — those are how secrets and stray artifacts slip in.
- Before committing, run the convention checker (`scripts/dev/check_repo_conventions.sh`) and the tests relevant to the touched subsystem. If either fails, fix the underlying problem before the commit. Do not bypass.
- Commit messages are imperative, ≤ 72 characters in the subject, with a body explaining *why*. Reference the ADR, bugfix entry, workstream ID, or milestone where relevant.
- Always create a new commit rather than amending — amending after a hook failure modifies the wrong commit and risks losing work.
- The `Co-Authored-By:` trailer for the Claude model that did the work is required.
- After a successful push, update `program_development/timeline.md` if the change is milestone-relevant.

### When pre-commit or pre-push hooks fail

Fix the underlying issue and create a new commit. Never use `--no-verify`. The hook is a defensive check installed deliberately — bypassing it is the same class of mistake as lowering a validation tolerance to make a test pass.

### When in doubt

If the action being taken is described above as "must not do without explicit user approval", or if the agent is uncertain whether a change qualifies as major, the agent commits locally but waits to push. The user can always trigger the push later.

---

## Agent Definition of Done

A task is done when:

1. Code changes complete.
2. Tests added or updated.
3. Tests run, or it is documented why they were not.
4. Documentation updated.
5. `README.md` updated if build/usage changed. Status fields agree with `program_development/milestones/` and `timeline.md` per **Phase Gate Discipline**.
6. `bugs_and_fixes/bugfixes.md` updated if bug-related, with a regression-test reference in `regression_tests.md`.
7. `program_development/timeline.md` updated if milestone-relevant.
8. No local temp/cache/generated files staged.
9. Generated code remains inspectable, with units and assumptions surfaced.
10. Convention checker (`scripts/dev/check_repo_conventions.sh`) passes. If the task added or changed a deliverable that the plan, README, or any milestone references, the checker has been **extended** to assert that deliverable — not just left at its prior assertions.
11. Every documented command path the change introduced exists on disk as an executable (or stub). Every plan-derived pattern (gitignore rule, filename, identifier) has been reality-tested.
12. **For workstream-completion tasks**: every plan-named entity in `§Phase N → Workstream NX` has been enumerated, asserted in the convention checker, implemented, and tested. The milestone's Pre-gate hint list has been updated where it disagreed with the plan. If any entity was deferred, the deferral is named in the commit message and an explicit follow-up checker assertion encodes the deferral.
13. The change is committed. If the change is *major* (per the criteria in **Autonomous Git Operations** above), it has also been pushed to `origin`.

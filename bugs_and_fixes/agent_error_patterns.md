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

## Error Pattern: Switching backends to make output "look better"

### Why it is bad
Backends are not interchangeable. Switching a CPU stiff-ODE simulation to a GPU explicit kernel changes physics fidelity, not just performance. Smoothed output may indicate the physics is actually wrong.

### Required behavior
Backend selection follows the criteria in plan §15.2 (problem size, stiffness, supported modules, reproducibility). Visual output quality is not one of the criteria.

### Detection
Review backend changes in PRs. Any backend switch that is justified by appearance rather than the §15.2 criteria is rejected.

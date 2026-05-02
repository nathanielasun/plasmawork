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

## Error Pattern: Switching backends to make output "look better"

### Why it is bad
Backends are not interchangeable. Switching a CPU stiff-ODE simulation to a GPU explicit kernel changes physics fidelity, not just performance. Smoothed output may indicate the physics is actually wrong.

### Required behavior
Backend selection follows the criteria in plan §15.2 (problem size, stiffness, supported modules, reproducibility). Visual output quality is not one of the criteria.

### Detection
Review backend changes in PRs. Any backend switch that is justified by appearance rather than the §15.2 criteria is rejected.

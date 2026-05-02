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

Commit: pending.

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

Commit: pending Phase 0 commit.

### Regression protection
- Added `scripts/build/.gitkeep` so the directory is staged.
- Documented the trap in `agent_error_patterns.md` (entry: "Bare gitignore globs that conflict with project directories").
- Extended `scripts/dev/check_repo_conventions.sh` to verify representative source paths under `scripts/build/`, `scripts/dev/`, `scripts/test/`, `scripts/docs/`, `packages/physics_modules/`, `apps/workbench-ui/`, and `docs_site/` are not gitignored.

### Agent warning
Do not generalize a `build/` ignore rule across the whole tree. Project directories whose name happens to be `build` exist deliberately. Anchor build-output ignores to the place they are produced, or use specific patterns like `apps/*/build/`.

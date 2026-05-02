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
- The convention checker should be extended (Phase 1) to verify that `scripts/build/<file>` and `scripts/dev/<file>` are not gitignored. Tracked as a follow-up.

### Agent warning
Do not generalize a `build/` ignore rule across the whole tree. Project directories whose name happens to be `build` exist deliberately. Anchor build-output ignores to the place they are produced, or use specific patterns like `apps/*/build/`.


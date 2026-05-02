# CLAUDE.md — Operating Manual for Claude Code Agents

This file is the operationally-explicit playbook for Claude Code agents working in the **Scientific Simulation Workbench** repository. It duplicates the durable rules from `AGENTS.md` and adds concrete commands and procedures.

If `AGENTS.md` and this file ever drift, `AGENTS.md` is the source of truth for *rules* and this file is the source of truth for *how to run things*.

---

## Mandatory Repository Rules

(Identical durable ruleset as `AGENTS.md`. Treat the following as load-bearing.)

1. Keep documentation synchronized with code. If behavior, configuration, APIs, simulation modules, or build instructions change, update `docs_site/src/content/<page>` and `README.md` before completing the task.

2. Maintain program documentation inside `docs_site/` as TypeScript/MDX pages. The workbench UI loads documentation from this canonical source.

3. Maintain a root-level `README.md`.

4. Maintain `.gitignore` — local caches, temp simulation files, intermediate paper imports, generated run outputs, and `.env` files must never be committed.

5. Keep temporary files inside `local_cache/`, `temp_imports/`, `temp_runs/`, and `simulation_capsules/`. Never write program artifacts to arbitrary user directories. External writes only via explicit export.

6. Maintain `bugs_and_fixes/` (see structure below).

7. Before modifying an existing subsystem, inspect `bugs_and_fixes/` for relevant historical bugs. Do not reintroduce known errors.

8. Maintain `program_development/` with timeline, ADRs, and milestone files.

9. Generated scientific simulations must be inspectable, editable, modular, exportable, reloadable, and tied to explicit assumptions, units, parameters, and validation checks.

10. Prefer precise validated modules over broad approximations. Missing coefficient → report, do not fabricate.

---

## How to Run the Program Locally

> The repository is in **Phase 0 / bootstrap**. The commands below are the planned interfaces. Where a script does not yet exist, the corresponding subsystem is scheduled for the noted phase. Do not invent command names; if a script is missing, add it to `scripts/dev/` as part of its phase rather than calling something else.

```bash
# One-time install (Python core + UI)
scripts/dev/install.sh

# Run the TypeScript workbench UI (Phase 1F)
scripts/dev/run_ui.sh

# Run the Python backend / API server (Phase 1A–C)
scripts/dev/run_backend.sh

# Run the docs site (Phase 0B)
scripts/docs/dev.sh
```

If you need a Python REPL with the workbench package importable:

```bash
cd packages/core
python -m pip install -e .
python -c "import simworkbench; print(simworkbench.__version__)"
```

---

## How to Run Tests

```bash
# All tests
scripts/test/all.sh

# Subsets
scripts/test/unit.sh
scripts/test/validation.sh
scripts/test/regression.sh
```

For a specific Python test file:

```bash
pytest tests/unit/test_modelspec.py -x -v
```

For TypeScript tests in the UI app:

```bash
cd apps/workbench-ui && npm test
```

---

## How to Update Documentation Pages

1. Open the relevant page under `docs_site/src/content/`. The required pages are:
   `overview`, `installation`, `usage`, `architecture`, `module_development`, `internal_tools`, `simulation_capsules`, `agent_workflows`, `validation`, `troubleshooting`.
2. Make the change in the MDX/TSX file.
3. Verify the docs site renders: `scripts/docs/dev.sh`.
4. If the change documents a new feature, also update `README.md` and the in-program docs viewer.
5. Add a timeline entry in `program_development/timeline.md` when the change is milestone-relevant.

---

## How to Add a Simulation Module

Modules live at `packages/physics_modules/<domain>/<name>/` (laser, plasma, species, spectroscopy, molecular_dynamics, phase_transition, pde, monte_carlo).

1. Copy `packages/physics_modules/templates/<closest-template>/` into the new path.
2. Edit `module.yaml` per plan §14.2: name, version, domain, status (`candidate`), declared inputs/outputs with units, validity domain, references.
3. Implement `src/`. Public functions take and return unit-aware quantities (no raw floats at the boundary).
4. Add tests in `tests/`: at minimum a unit test for I/O contracts and a validation test for a limiting/analytical case.
5. Add `README.md`, `assumptions.md`, `validity_domain.md`, `equations.md`, `changelog.md`, `examples/`.
6. Register the module: add a row to `packages/physics_modules/<domain>/index.yaml` (or run `scripts/dev/refresh_registry.sh`).
7. Run `scripts/test/validation.sh` to confirm.
8. Update `docs_site/src/content/module_development.tsx` if the module introduces a new interface pattern.

Promotion `candidate → validated` requires the criteria in plan §14.3 and a human reviewer.

---

## How to Add an Internal Tool

Internal tools are diagnostic, visualization, importer, validator, exporter, etc. They live at `packages/internal_tools/registry/<tool_name>/`.

1. From the workbench UI: **Internal Tools → New Tool from Template**, OR copy `packages/internal_tools/templates/<category>/` into the registry.
2. Edit `tool.yaml` per plan §9.3: name, version, type, entrypoint, declared inputs/outputs with units, compatible domains, requires, validation tests.
3. Implement `src/tool.py` extending `simworkbench.tools.BaseTool` with `validate_inputs` and `run`.
4. Add tests in `tests/`.
5. Add `README.md`, `docs/`, `examples/`.
6. Register: `scripts/dev/refresh_registry.sh` (or restart the UI).
7. Tool starts in `draft`. After tests pass it becomes `candidate`. Promotion to `trusted` requires a human reviewer.

---

## How to Inspect the Bugfix History Before Modifying Code

Before editing files in any subsystem:

```bash
# 1. Find which subsystem you're touching, then grep the bug log for it
grep -nE "packages/core/runtime|runtime/" bugs_and_fixes/bugfixes.md
grep -nE "your-subsystem-keyword" bugs_and_fixes/known_failures.md
grep -nE "your-pattern" bugs_and_fixes/agent_error_patterns.md
```

If the area has prior bugs:
- Read the relevant entry. Note the regression test that protects against the bug.
- Run that regression test before and after your change: `pytest <linked test path>`.
- If your change might affect the protected invariant, explain why in the commit message and add a new regression test if behavior changes intentionally.

---

## How to Avoid Writing Temporary Files Outside the Installation Directory

- Always use `pathlib.Path(__file__).resolve()` or the `simworkbench.paths` module to resolve workbench-relative paths.
- Allowed temp roots:
  - `local_cache/` — caches, downloaded coefficient tables, parsed paper artifacts
  - `temp_imports/` — imports staged for review
  - `temp_runs/` — in-flight run artifacts before promotion to a capsule
  - `simulation_capsules/` — finalized capsule directories
- Use `tempfile.TemporaryDirectory(dir=local_cache_root())` rather than the system tempdir for anything that should be cleanable by `scripts/clean/local_temp.sh`.
- Do not write to `~/`, `/tmp/`, or absolute paths chosen by the agent.

---

## How to Keep Generated Code Readable and Exportable

When an agent generates simulation code into a capsule:

- Place it in `<capsule>/src/generated/`. User edits go in `<capsule>/src/user_edits/` — never overwrite that directory.
- Format with the project formatter (`ruff format` for Python, `prettier` for TS).
- Top-of-file header must declare: source paper (DOI/title), ModelSpec version, generation timestamp, agent identifier.
- Public functions get docstrings stating units and assumptions.
- Generated code must be runnable in isolation: `python <capsule>/src/generated/run.py`.
- Capsule export (`scripts/export/capsule.sh <name>`) must produce a self-contained archive.

---

## How to Maintain Scientific Provenance

Every run touches `<capsule>/provenance/`:

- `provenance.lock` — environment, package versions, backend, hardware metadata, random seeds, ModelSpec hash, source-code hashes.
- `agent_trace.md` — chronological record of each agent action: which inputs were read, which decisions were made, which files were generated/modified.
- `environment.yaml` — pip/conda freeze.

Never delete or rewrite `provenance/` files in a completed capsule. To re-run with changes, fork the capsule (`scripts/export/fork_capsule.sh <src> <dst>`).

---

## Off-Limits Directories for Destructive Edits

The following directories must not be modified by an agent except via the documented interface:

| Directory | Allowed change | Forbidden |
|---|---|---|
| `<capsule>/provenance/` | Append-only via runtime | Manual edits, deletions |
| `<capsule>/src/user_edits/` | User only | Agent overwrites |
| `<capsule>/paper_sources/` | Initial import only | Edits to original paper files |
| `bugs_and_fixes/` | Add new entries | Removing or rewriting historical bug entries |
| `program_development/architectural_decisions/` | New ADRs, status updates on existing ADRs | Rewriting accepted ADRs |
| `physics_modules/.../validated/` and `.../trusted/` modules | New version branches | In-place behavioral changes without an ADR |
| `LICENSE` | None | Any modification |

When in doubt, ask before editing. Prefer reversible additions over destructive rewrites.

---

## Phase-Specific Operational Notes

The repository is currently in **Phase 0** (Repository Bootstrap). Until Phase 0 is complete, the only valid scope of agent work is:

- Creating root governance files
- Creating directory structure
- Creating docs site skeleton
- Creating bugfix and dev-history templates
- Creating example configs
- Creating the convention checker

Do not start Phase 1 work (ModelSpec, runtime, modules) until the convention checker passes.

---

## Autonomous Git Operations (Claude-Specific)

The user has authorized — durably, in this file and in `AGENTS.md` — autonomous commits and pushes for this repository. This authorization replaces the harness default of "always ask before committing or pushing" *for this repo only*. Other repositories require explicit approval as usual.

### TL;DR
- Commit after every meaningful unit of work.
- Push to `origin/<current-branch>` after every **major** change (definition below).
- Never force-push, never `--no-verify`, never stage secrets or artifacts, never amend.
- If anything is ambiguous, commit but hold the push.

### What counts as a "major change" — push immediately

Push as soon as any one of these is true:

| Trigger | Example |
|---|---|
| Workstream completed | "Phase 0 / Workstream 0B done" |
| Phase gate passed | "Phase 0 gate verified" |
| Bug fixed and logged | New entry in `bugs_and_fixes/bugfixes.md` |
| Module / tool status transition | `candidate → validated`, etc. |
| ADR change | Accepted, deprecated, or superseded |
| Milestone update | New phase started or completed |
| Multi-file diff | More than ~3 files of meaningful change, or crosses subsystem boundaries |
| User-visible feature | Shipped or removed |

Routine in-progress edits — single-file polish, typo fixes, partial work — get a commit but **wait on the push** until they bundle into a major change.

### What requires explicit user approval (never autonomous)

- Force-push (`--force`, `--force-with-lease`) to any branch.
- Rebase / amend that rewrites commits already on `origin`.
- `git reset --hard`, `git checkout --`, `git clean -f`, `git branch -D` (except for transient agent-created branches).
- Skipping hooks: `--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`, etc.
- Committing files that may contain secrets: `.env`, `.env.*`, `*.local.yaml`, `*credentials*`, service-account JSON, anything with API keys. If such a file is in the diff, **stop and ask**.
- Pushing to a branch other than the current branch's tracked upstream.
- Creating, closing, merging, or commenting on PRs, issues, or releases. Use `gh` only when the user explicitly requests it.
- Tagging releases.

### The autonomous commit-and-push procedure

When a major change is ready:

1. **Verify the work**
   ```bash
   bash scripts/dev/check_repo_conventions.sh
   ```
   Run any tests relevant to the changed subsystem (Phase 1+ this means `scripts/test/<subset>.sh`).
   If anything fails, fix the root cause and re-verify. Never bypass.

2. **Inspect the diff**
   ```bash
   git status --short
   git diff --stat
   git diff
   ```
   Confirm there are no unintended changes, no secrets, no temp/cache/output artifacts. Confirm the convention checker is happy.

3. **Stage by explicit path** — never `git add -A` or `git add .`
   ```bash
   git add AGENTS.md CLAUDE.md scripts/dev/check_repo_conventions.sh   # example
   ```

4. **Commit with a HEREDOC** so the message body keeps its formatting and the co-author trailer survives:
   ```bash
   git commit -m "$(cat <<'EOF'
   Phase 0 complete: governance, docs skeleton, bug memory, dev history

   - Repository skeleton with .gitkeep markers (Workstream 0A).
   - Vite + React docs site with the ten content pages from §4.2 (0B).
   - bugs_and_fixes/ + agent_error_patterns and the first real bugfix (0C).
   - program_development/ with timeline, ADR-0001..0003, milestone stubs (0D).
   - Convention checker at scripts/dev/check_repo_conventions.sh (90 checks, gate green).

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

5. **Verify the commit landed**
   ```bash
   git status
   git log -1
   ```
   If a pre-commit hook failed, the commit did *not* happen. Fix the underlying issue and create a NEW commit — never `--amend` after a hook failure.

6. **Push to origin's tracked branch**
   ```bash
   git push
   ```
   Plain `git push` is correct because every branch in this repo tracks its `origin/<name>` upstream. Do not pass `--force` or `--force-with-lease` autonomously.

7. **If `git push` fails because the remote moved ahead**
   - Pull with rebase: `git pull --rebase --autostash`.
   - Resolve any conflicts (do not discard upstream commits).
   - Re-run convention checker and tests.
   - Push.
   - If the rebase would rewrite commits already on origin, stop and ask the user.

8. **Update the timeline if milestone-relevant**
   Append an entry to `program_development/timeline.md` and include it in a follow-up commit (or in the same commit if it was prepared up-front).

### Commit message style

- Imperative subject ≤ 72 characters.
- Blank line, then a body explaining *why* the change exists. The diff already shows *what*.
- Reference the ADR / bugfix / workstream / milestone the commit corresponds to.
- One commit per logical unit. Do not pile unrelated changes into one commit; split with `git add -p` if needed.
- Always include the `Co-Authored-By:` trailer for the Claude model that did the work.

### When pre-commit or pre-push hooks fail

Fix the actual problem. Investigate, do not bypass. Hooks exist because someone (us) installed them deliberately. Bypassing a hook is the same category of mistake as lowering a validation tolerance — it makes the immediate problem disappear and pushes the cost to a future surprise.

### When in doubt

Commit locally, hold the push, and tell the user what you did and why you held back. The user can run a single `git push` to release the work, or course-correct the commit before it goes out. This is cheap; an erroneous push is not.

---

## Definition of Done (Claude-Specific)

A Claude task is done when, in addition to the `AGENTS.md` checklist:

- `scripts/dev/check_repo_conventions.sh` passes (when implemented).
- The summary at the end of the response names the changed files and any decisions deferred to the user.
- Any new public API has a usage example in the relevant docs page.
- The change is committed. If it qualifies as **major** (per the criteria above), it has also been pushed to `origin`.

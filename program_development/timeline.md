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

## 2026-05-02

### Completed
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

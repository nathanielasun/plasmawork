# Phase 0 — Repository Bootstrap and Governance

**Status: Complete (2026-05-02)**

## Objective
Create the project structure, agent files, documentation rules, bug-memory system, and development-history system. (Plan §Phase 0.)

## Workstreams

| ID | Title | Status | Notes |
|---|---|---|---|
| 0A | Repository Skeleton | Done | Root files, directory skeleton with `.gitkeep` markers, example configs |
| 0B | Documentation Site Skeleton | Done | Vite + React + React Router site at `docs_site/` with ten content pages |
| 0C | Bugs and Fixes System | Done | 5 files in `bugs_and_fixes/` plus `program.log.example`; first bugfix logged |
| 0D | Development History System | Done | timeline + 3 ADRs + 6 milestone stubs |

## Deliverables

- [x] Root governance files: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore`
- [x] Full directory skeleton with `.gitkeep` markers
- [x] Example configs (`configs/default.yaml`, `local.yaml.example`, `backends.yaml`, `agents.yaml`)
- [x] Documentation site skeleton with all ten required pages
- [x] `bugs_and_fixes/` populated with templates and pre-emptive agent error patterns
- [x] `program_development/` populated with timeline, ADR-0001..0003, milestone stubs
- [x] Repository convention checker script (`scripts/dev/check_repo_conventions.sh`, 90 checks)
- [x] Phase 0 gate verification

## Phase Gate (per plan §Phase 0)

Phase 0 is complete when:

1. ☑ Repository structure exists.
2. ☑ Agent files exist.
3. ☑ README exists.
4. ☑ Docs site skeleton exists.
5. ☑ `.gitignore` protects local caches/temp files.
6. ☑ Bugs and development folders exist.
7. ☑ Convention checker runs and passes (90/90 checks ok on 2026-05-02).

## Notes / decisions
- Pre-populated `agent_error_patterns.md` with six guardrail patterns derived from plan §22 / §16.3, plus the gitignore-collision pattern from the first real bug we caught. Rationale: codifying these up-front reduces the chance of agents re-discovering them.
- `program.log` itself is gitignored; only `program.log.example` is committed.
- ADR-0002 (capsule format) is **Proposed**; final HDF5-vs-Zarr lock-in is deferred to Phase 2.
- Bare `build/` ignore rule was anchored to root after we caught it swallowing `scripts/build/`. See `bugs_and_fixes/bugfixes.md` 2026-05-02.
- Convention checker also runs a gitignore-collision regression: probes `scripts/build/ui.sh`, `apps/workbench-ui/src/app/page.tsx`, etc. to ensure they're not silently ignored.

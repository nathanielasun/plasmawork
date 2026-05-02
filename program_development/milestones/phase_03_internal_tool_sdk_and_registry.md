# Phase 3 — Internal Tool SDK and Registry

**Status: Not started**

## Objective
Allow users and agents to create, import, validate, document, and reuse internal tools. (Plan §Phase 3.)

## Workstreams

| ID | Title | Notes |
|---|---|---|
| 3A | Tool SDK | `BaseTool`, input/output contracts, metadata, unit validation, runtime hooks |
| 3B | Tool Registry | local registry, discovery, import, versioning, lifecycle, deprecation |
| 3C | Tool Templates | diagnostic, visualization, import, physics module, solver adapter, validation, paper extraction |
| 3D | Tool UI | list, view docs, edit, run tests, import, export, status |
| 3E | Tool Documentation | docs page, tutorial, walkthrough, validation requirements |

## Phase Gate
Phase 3 is complete when a user can create a custom diagnostic tool, test it, document it, register it, use it in an experiment, and export it.

## Acceptance scenario
End-to-end scenario follows plan §18.3: create a diagnostic tool from a template, edit it, test it, register it as `candidate`, apply it to an experiment, and later promote it only with human-reviewed validation evidence.

## Pre-gate verification

Phase 0's first gate was a false positive — see `bugs_and_fixes/bugfixes.md` 2026-05-02 *Phase 0 gate false positive*. Before this phase opens or closes, follow `CLAUDE.md → Phase Gate Procedure` and `AGENTS.md → Phase Gate Discipline`.

### Convention-checker assertions to add when this phase opens

Starting-point hints from plan §Phase 3:

- ☐ `packages/internal_tools/sdk/base_tool.py` — `BaseTool` ABC plus `ToolInput` / `ToolOutput` contracts.
- ☐ `packages/internal_tools/registry/index.yaml` — registry manifest enumerating registered tools and their lifecycle states.
- ☐ One template per category in `packages/internal_tools/templates/` (diagnostic, visualization, import, physics module, solver adapter, validation, paper extraction).
- ☐ At least one example tool — likely the absorption-spectrum diagnostic from plan §9.4 — under `packages/internal_tools/registry/<name>/` with `tool.yaml`, `src/`, `tests/`, `docs/`, `examples/`, `README.md`.
- ☐ Tool manager UI accessible from `apps/workbench-ui/` with list / view / edit / run-tests / import / export / status controls.
- ☐ `docs_site/src/content/internal_tools.tsx` — Phase-0 banner replaced; tutorial walkthrough added.
- ☐ `scripts/dev/refresh_registry.sh` exists and refreshes the registry cache.
- ☐ Tool lifecycle `draft → candidate → validated → trusted → deprecated` is enforced by the registry, not by convention.
- ☐ `tests/unit/test_base_tool.py`, `tests/integration/test_tool_registry.py`.

### Status sync at close

Flip the status in one commit touching this milestone, `README.md` Phase 3 row, `timeline.md`, the example tool's `tool.yaml` lifecycle field, and any docs page that named "Phase 3 — pending".

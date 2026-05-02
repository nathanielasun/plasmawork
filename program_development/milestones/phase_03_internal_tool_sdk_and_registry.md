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

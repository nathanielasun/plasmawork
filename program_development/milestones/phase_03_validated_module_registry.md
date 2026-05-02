# Phase 3 — Internal Tool SDK and Registry

**Status: Not started**

> Note: the plan numbers Phase 3 as "Internal Tool SDK and Registry" (plan §Phase 3). The filename keeps the original plan's placeholder convention; the content below tracks the actual Phase 3.

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
End-to-end the same as plan §18.3:
1. User opens Internal Tools panel.
2. Creates "New Diagnostic Tool" from template.
3. Edits code.
4. Tests pass.
5. Tool reaches `candidate`.
6. Tool is applied to an experiment.
7. After repeated validation, user promotes tool to `trusted`.

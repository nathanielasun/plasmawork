---
name: simworkbench-tool-construction
description: Build, validate, document, review, and UI-bind Scientific Simulation Workbench internal tools using the repo-local tool.yaml contract, registry lifecycle, artifact I/O, and security/provenance rules.
---

# SimWorkbench Tool Construction

Use this skill when creating, modifying, reviewing, validating, or UI-binding
an internal tool under `packages/internal_tools/`.

## Workflow

1. Inspect bug memory before editing:
   `rg -n "tool|registry|artifact|validation|unit|path|approval|sandbox" bugs_and_fixes/`.
2. Classify the tool as import, diagnostic, visualization, validation, export,
   solver adapter, paper extraction, physics helper, or automation.
3. Start from the closest `packages/internal_tools/templates/<category>/`
   package unless a reviewed design says otherwise.
4. Write `tool.yaml` first. Declare inputs, outputs, units, entrypoint,
   validation tests, examples/docs, permissions, UI hints, artifacts, and
   provenance expectations before implementation.
5. Implement the tool as a `BaseTool` subclass. `validate_inputs` rejects bad
   inputs before `run`; `run` returns only declared outputs.
6. Add tests, examples, and docs. Include negative tests for malformed inputs,
   unit mistakes, path escapes, and unsupported output shapes.
7. Run the deterministic checker:
   `.agents/skills/simworkbench-tool-construction/scripts/check_tool_package.py <tool-package>`.
8. When using the Tools page builder, keep drafts under
   `local_cache/workspaces/<workspace>/tool_drafts/`, use code templates via
   `/api/tool-authoring/code-templates`, preview only through bounded harnesses,
   and provide delete/archive paths for every local artifact you create.
9. Bind UI from the normalized contract. Do not hard-code raw fetch calls or
   privileged behavior in components.
10. Promote lifecycle state only through the registry/service gate. Agents may
   create `draft` or `candidate`; higher states need human approval evidence.
11. Update user-facing docs and bug memory when behavior or error patterns
    change.

## References

- Read `references/tool_package_contract.md` when authoring or reviewing
  `tool.yaml`. Tag: `TOOL-CONTRACT`.
- Read `references/tool_ui_binding_contract.md` when adding UI hints,
  artifact renderers, diagrams, or data I/O. Tags: `TOOL-UI-BINDING`,
  `TOOL-ARTIFACT-IO`.
- Read `references/security_and_provenance.md` before touching permissions,
  filesystem/network access, approvals, sandboxing, artifacts, or workspace
  routes. Tag: `TOOL-SECURITY`.
- Read `references/validation_checklist.md` before closing a tool task or
  promoting lifecycle status. Tags: `TOOL-VALIDATION`, `TOOL-PROMOTION`.

Keep this skill concise. Put durable detail in one-hop references and enforce
invariants in scripts/tests, not prompt prose.

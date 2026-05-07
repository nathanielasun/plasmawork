# Tool Construction Methodology and UI Binding Plan

Status: Draft for approval
Date: 2026-05-07
Owner: Scientific Simulation Workbench maintainers

This plan extends the existing internal-tool SDK and registry into a durable
tool-authoring methodology for development agents and a general UI workbench
for users who need to run tools, inspect outputs, and work with data and
diagrams.

The current implementation already provides:

- `packages/internal_tools/templates/` for tool scaffolds.
- `packages/internal_tools/registry/<tool_name>/tool.yaml` as the registry
  contract.
- `simworkbench.tools.BaseTool`, `ToolInput`, `ToolOutput`, metadata loading,
  lifecycle gates, registry discovery, import/export, and validation-test
  execution.
- Local API endpoints under `/api/tools`.
- A UI Tools route that lists, imports, inspects, tests, exports, documents, and
  promotes tools.

The current gaps are:

- Agents do not have a repo-maintained skill that teaches the workbench-specific
  tool-building method.
- The UI does not yet expose a general tool execution workspace with
  schema-derived inputs, data import/mapping controls, output artifact browsing,
  or safe diagram rendering.
- Tool output is returned mostly as inline JSON; larger outputs, files, tables,
  figures, graph specs, and provenance should be represented as typed artifacts.
- The local tool API and secure multi-user tool model need one shared contract
  so the UI can move from local-only execution to workspace-scoped execution
  without another rewrite.

---

## Goals

1. Maintain a repository-owned agent skill for building internal tools.
2. Make the skill importable into agent workflows without bloating
   `AGENTS.md`, `CLAUDE.md`, or user docs.
3. Define a stable tool package contract that covers source, schemas, units,
   permissions, validation, examples, UI hints, data I/O, diagrams, and
   provenance.
4. Add a general UI binding so users can run any registered tool through a
   consistent interface.
5. Support tool outputs as typed renderable objects: scalar, table, timeseries,
   file, image, plot, graph, flow diagram, schema diagram, and report.
6. Keep secure multi-user requirements intact: server-derived identity,
   workspace-scoped object references, sandboxed execution, approval gates for
   high-risk actions, and no client-supplied storage facts.

## Non-Goals

- Do not create a public marketplace.
- Do not allow arbitrary raw HTML/JS output from tools.
- Do not let a tool write outside workbench-managed roots or workspace
  artifact namespaces.
- Do not make lifecycle promotion depend on UI checks. The registry/service
  remains the mutation boundary.
- Do not duplicate the full tool methodology into `AGENTS.md` or `CLAUDE.md`.
  Those files should carry short lookup pointers only.

---

## Proposed Repository Layout

### Agent Skill Source

Canonical repo-local skill package:

```text
.agents/skills/simworkbench-tool-construction/
  SKILL.md
  agents/openai.yaml
  references/
    tool_package_contract.md
    tool_ui_binding_contract.md
    security_and_provenance.md
    validation_checklist.md
  scripts/
    check_tool_package.py
```

Rationale:

- `.agents/skills/` makes the artifact clearly agent-facing.
- `SKILL.md` stays concise and follows the Codex skill anatomy: YAML
  frontmatter with `name` and `description`, then a short workflow.
- Detailed workbench-specific rules live in `references/` and are loaded only
  when needed.
- Deterministic validation lives in `scripts/check_tool_package.py` rather than
  being reimplemented by every agent.
- The skill package intentionally does not contain `README.md`, changelog, or
  auxiliary documents. The skill itself is the importable artifact.

Optional installer/sync command:

```text
scripts/dev/install_tool_construction_skill.sh
```

This command should copy or symlink the repo-local skill into the local agent
runtime, such as `$CODEX_HOME/skills/simworkbench-tool-construction`, and print
the exact installed location. The command must be executable if documented in
current docs.

### Tool Package Contract

Existing package layout remains:

```text
packages/internal_tools/registry/<tool_name>/
  tool.yaml
  README.md
  src/
  tests/
  docs/
  examples/
  assumptions.md
  changelog.md
```

`tool.yaml` should be extended carefully because `ToolMetadata` currently
forbids unknown keys. Proposed additions:

```yaml
io:
  mode: inline | artifact | mixed
  max_inline_bytes: 65536

permissions:
  filesystem: none | read_artifacts | write_artifacts
  network: none | proxy_required
  high_risk_actions: []

ui:
  display_name: Cross-section Table Importer
  input_groups:
    - id: source
      title: Source Data
      ports: [file, units, column_map]
  output_views:
    - port: normalized_table
      renderer: table
    - port: transform_graph
      renderer: graph

artifacts:
  outputs:
    - name: normalized_table
      kind: table
      mime_type: application/json
    - name: transform_graph
      kind: diagram
      diagram_type: graph
```

The exact schema can be adjusted during implementation, but the invariant is
that UI hints and artifact behavior are declared in metadata, validated by
Pydantic/JSON Schema, and tested. The UI must not infer privileged behavior
from free-form strings.

---

## Agent Skill Workflow

The skill should guide agents through this short, enforced sequence:

1. **Classify the tool.** Choose import, diagnostic, visualization, validation,
   export, solver adapter, paper extraction, physics helper, or automation.
2. **Inspect bug memory.** Grep `bugs_and_fixes/` for tool, registry,
   artifact, validation, unit, path, approval, and sandbox patterns.
3. **Start from a template.** Copy the closest
   `packages/internal_tools/templates/<category>/` template or use the UI
   builder once implemented.
4. **Write the contract first.** Fill `tool.yaml`, including inputs, outputs,
   units, permission needs, UI hints, artifact outputs, validation tests, and
   examples.
5. **Implement `BaseTool`.** `validate_inputs` rejects bad input before `run`;
   `run` returns declared outputs only.
6. **Add tests and examples.** At least one unit test, one validation test or
   reference case, one example, and negative tests for malformed input.
7. **Run the deterministic package checker.** Use the skill script and the repo
   convention checker.
8. **Bind to UI.** Verify schema-derived form rendering, execution, output
   viewers, docs, validation, and provenance.
9. **Update docs.** Update `docs_site/src/content/internal_tools.tsx`,
   `STYLING.md` if UI patterns changed, and bug memory if the work fixed or
   exposed an error pattern.
10. **Promote only through the registry/service gate.** Agents may create
    `draft` or `candidate`; higher states require human approval and evidence.

The skill should include stable grep terms:

- `TOOL-CONTRACT`
- `TOOL-UI-BINDING`
- `TOOL-ARTIFACT-IO`
- `TOOL-SECURITY`
- `TOOL-VALIDATION`
- `TOOL-PROMOTION`

These tags let future agents find the right reference quickly.

---

## General UI Binding Architecture

### Route and Component Shape

Replace the current disabled construction card with a real tool workbench:

```text
apps/workbench-ui/src/components/tools/
  ToolList.tsx
  ToolDetail.tsx
  ToolDocs.tsx
  ToolStatus.tsx
  ToolWorkbench.tsx
  ToolInputForm.tsx
  ToolDataMapper.tsx
  ToolRunConsole.tsx
  ToolOutputInspector.tsx
  ToolArtifactBrowser.tsx
  ToolDiagramViewer.tsx
  ToolValidationPanel.tsx
```

Recommended page layout:

- Left rail: searchable tool library grouped by type/status.
- Center workspace: selected tool, schema-derived input form, run/preview
  controls, execution status, validation errors.
- Right inspector: contract, docs, permissions, provenance, lifecycle,
  examples, and prior runs.
- Bottom/output region: tables, diagrams, files, plots, JSON, logs, and
  generated artifacts with tabs.

The UI must remain functional before beautification:

- Long labels wrap without overlapping controls.
- Data tables scroll horizontally inside their panel.
- Diagram panels have explicit zoom/pan/reset controls.
- Output panes never hide validation errors below the fold.
- Disabled controls include a reason: missing permission, missing approval,
  unsupported renderer, failed validation, or backend unavailable.

### Input Binding

Inputs are generated from the validated tool contract:

- `scalar`: numeric field with units selector when units are declared.
- `array`: file upload/artifact reference plus preview and unit validation.
- `table`: CSV/JSON artifact picker, schema preview, column mapping.
- `string`: text field or multiline editor depending `ui.widget`.
- `bool`: checkbox.
- `enum`: select.
- `file`: artifact picker/upload control; never raw arbitrary server path in
  secure mode.
- `capsule`: capsule selector scoped to the active workspace.

The local API may accept JSON for early implementation, but the secure target
must accept object references and derive storage facts server-side.

### Output Binding

Outputs are rendered by declared kind:

- `scalar`: metric card with units.
- `table`: virtualized table, column metadata, export control.
- `timeseries`: line plot using the existing diagnostics plot conventions.
- `heatmap`: matrix/field plot.
- `particle_scatter`: particle/scatter renderer.
- `image`: safe image artifact display.
- `diagram`: structured JSON rendered as graph, flow, schema, or pipeline
  diagram; raw HTML is refused.
- `file`: artifact card with hash, size, MIME type, provenance, and download or
  capsule-attach action.
- `report`: Markdown preview after sanitization.
- `json`: collapsible JSON tree for unsupported-but-safe structures.

Unknown output kinds render as a safe unsupported-state panel with raw JSON
behind an explicit inspection toggle.

---

## API and Runtime Plan

### Local Core API

Existing endpoints stay supported:

- `GET /api/tools`
- `GET /api/tools/{name}`
- `GET /api/tools/{name}/docs`
- `POST /api/tools/{name}/status`
- `POST /api/tools/{name}/run-tests`
- `POST /api/tools/{name}/execute`
- `POST /api/tools/{name}/export`
- `POST /api/tools/import`

Add or evolve:

- `GET /api/tools/{name}/schema` returns the normalized contract used by the
  UI. It should not expose Python internals.
- `POST /api/tools/{name}/preview` validates inputs and returns planned
  artifacts/permissions without side effects.
- `POST /api/tools/{name}/runs` creates a tool run and returns `run_id`.
- `GET /api/tools/{name}/runs/{run_id}` returns status, logs, validation,
  output refs, and errors.
- `GET /api/tools/{name}/runs/{run_id}/artifacts` lists output artifacts.
- `GET /api/tool-artifacts/{artifact_id}` reads a safe preview by artifact id.

`execute` may remain as a synchronous compatibility wrapper around
`runs` for small tools.

### Core Runtime Types

Add:

```text
packages/core/src/simworkbench/tools/schema.py
packages/core/src/simworkbench/tools/run_manager.py
packages/core/src/simworkbench/tools/artifacts.py
packages/core/src/simworkbench/tools/renderers.py
```

Responsibilities:

- Normalize `tool.yaml` into a UI-safe contract.
- Validate user input against ports, units, shape, and artifact type.
- Create a run directory under a workbench-managed root.
- Convert outputs to inline values or artifacts based on size/type.
- Emit provenance for input artifacts, tool version, run parameters, output
  hashes, and validation results.
- Refuse path escapes before any write.

### Secure Multi-User API Target

Map the local API to workspace-scoped secure-core routes:

- `GET /workspaces/:workspaceId/tools`
- `GET /workspaces/:workspaceId/tools/:toolId`
- `POST /workspaces/:workspaceId/tools/:toolId/runs`
- `GET /workspaces/:workspaceId/tools/:toolId/runs/:runId`
- `GET /workspaces/:workspaceId/tool-runs/:runId/artifacts`
- `POST /workspaces/:workspaceId/tools/:toolId/promote-request`

Rules:

- The browser sends tool id, input values, artifact ids, and approval request
  ids only.
- Server derives actor, workspace membership, role/capability, storage path,
  content hash, status, and timestamps.
- Every artifact lands under `workspaces/<workspace_id>/...`.
- High-risk permissions require approval before side effects.
- Sandbox/quota reservation happens before tool output writes.
- Failed validation cleans up every created file.

---

## Implementation Stages

### Stage 1 — Methodology Artifact and Skill Skeleton

Files:

- `.agents/skills/simworkbench-tool-construction/SKILL.md`
- `.agents/skills/simworkbench-tool-construction/agents/openai.yaml`
- `.agents/skills/simworkbench-tool-construction/references/*.md`
- `.agents/skills/simworkbench-tool-construction/scripts/check_tool_package.py`
- `scripts/dev/install_tool_construction_skill.sh`
- `program_development/tool_construction_methodology_plan.md`
- `docs_site/src/content/internal_tools.tsx`
- `AGENTS.md`
- `CLAUDE.md`

Tasks:

- Add the repo-local skill with concise frontmatter and a short workflow.
- Add reference docs split by contract, UI binding, security, and validation.
- Add a deterministic checker for a single tool package.
- Add convention-checker assertions that the skill exists, has valid
  frontmatter, links to references, and contains the stable grep tags.
- Add short lookup pointers to AGENTS/CLAUDE only; do not paste the full
  methodology into either file.

Acceptance:

- `scripts/dev/check_repo_conventions.sh` verifies the skill package.
- Skill body stays under 500 lines and reference files are one hop from
  `SKILL.md`.
- Internal-tools docs explain the user-facing method without agent-only wording.

### Stage 2 — Tool Contract Schema Expansion

Files:

- `packages/core/src/simworkbench/tools/metadata.py`
- `packages/core/src/simworkbench/tools/io.py`
- `packages/core/src/simworkbench/tools/schema.py`
- `packages/internal_tools/templates/*/tool.yaml`
- `packages/internal_tools/registry/absorption_spectrum_diagnostic/tool.yaml`
- `tests/unit/test_tool_metadata.py`
- `tests/regression/test_tool_contract_ui_schema.py`

Tasks:

- Extend `ToolMetadata` with validated `io`, `permissions`, `ui`, and
  `artifacts` sections.
- Keep `extra="forbid"` so typos still fail loudly.
- Add schema normalization for UI and API clients.
- Add negative tests for unitless arrays, unsafe renderer values, unknown
  metadata keys, path-shaped artifact claims, and high-risk permissions without
  approval declarations.

Acceptance:

- Existing tools still load after templates are updated.
- A malformed `tool.yaml` fails with the file path and field name.
- UI-safe schema output contains no executable Python internals.

### Stage 3 — Tool Run and Artifact Runtime

Files:

- `packages/core/src/simworkbench/tools/run_manager.py`
- `packages/core/src/simworkbench/tools/artifacts.py`
- `packages/core/src/simworkbench/api/server.py`
- `tests/integration/test_tool_run_artifacts.py`
- `tests/regression/test_tool_artifact_path_isolation.py`

Tasks:

- Add `ToolRun`, `ToolRunStatus`, and `ToolRunArtifact` models.
- Convert synchronous `execute` into a compatibility path backed by the run
  manager.
- Store outputs as inline JSON or artifact files depending type/size.
- Add preview/validate route that performs no side effects.
- Emit provenance for inputs, tool version, output hashes, and errors.

Acceptance:

- Reference diagnostic tool runs through the new manager.
- A table output and a diagram output are produced and readable by artifact id.
- Path traversal and write-outside attempts fail before any filesystem write.
- Failed runs clean up partial artifacts and report structured errors.

### Stage 4 — General Tool Workbench UI

Files:

- `apps/workbench-ui/src/api/client.ts`
- `apps/workbench-ui/src/components/tools/ToolWorkbench.tsx`
- `apps/workbench-ui/src/components/tools/ToolInputForm.tsx`
- `apps/workbench-ui/src/components/tools/ToolDataMapper.tsx`
- `apps/workbench-ui/src/components/tools/ToolRunConsole.tsx`
- `apps/workbench-ui/src/components/tools/ToolOutputInspector.tsx`
- `apps/workbench-ui/src/components/tools/ToolArtifactBrowser.tsx`
- `apps/workbench-ui/src/components/tools/ToolDiagramViewer.tsx`
- `apps/workbench-ui/src/components/tools/ToolValidationPanel.tsx`
- `apps/workbench-ui/src/styles.css`
- `STYLING.md`
- `apps/workbench-ui/src/__tests__/ToolWorkbench.test.tsx`

Tasks:

- Replace disabled construction controls with real schema-bound controls.
- Add typed API client request/response shapes before UI code.
- Add form renderers for scalar, array, table, string, bool, enum, file, and
  capsule inputs.
- Add output renderers for scalar, table, timeseries, heatmap, scatter, image,
  diagram, file, report, and JSON.
- Add a data-mapping panel for CSV/table tools.
- Add safe diagram rendering from structured JSON only.
- Add responsive styling and overflow handling per `STYLING.md`.

Acceptance:

- Vitest mounts the full Tool Workbench against mocked APIs and executes a
  sample tool.
- The UI renders table and diagram outputs without overlap or hidden errors.
- No component calls `fetch` directly; all network calls use `apiClient`.
- The current disabled "construction surfaces not yet bound" card is gone or
  replaced with permission-gated real controls.

### Stage 5 — Secure Workspace Binding

Files:

- `packages/secure_core/src/routes/tools.ts`
- `packages/secure_core/src/tools/service.ts`
- `packages/secure_core/src/db/schema.ts`
- `packages/secure_core/src/db/migrations/*.sql`
- `packages/secure_core/test/routes/tools.test.ts`
- `packages/secure_core/test/security/section29_coverage.test.ts`
- `docs_site/src/content/workspaces.tsx`
- `docs_site/src/content/security_testing.tsx`

Tasks:

- Add workspace-scoped tool run and artifact tables if needed.
- Bind tool execution to authenticated session, live workspace membership, and
  tool capabilities.
- Require approval for high-risk permissions.
- Reserve quota before artifact writes.
- Emit audit/provenance events for run create, deny, complete, fail, export,
  and promotion request.
- Preserve global trusted tool visibility while refusing mutation against
  global tools from workspace routes.

Acceptance:

- Security tests cover missing membership, missing capability, wrong workspace,
  forged actor, forged storage path, approval reuse, and quota failure.
- Local single-user API remains usable, but secure routes are the target for
  deployed multi-user UI.

### Stage 6 — Documentation, Examples, and Regression Gates

Files:

- `docs_site/src/content/internal_tools.tsx`
- `docs_site/src/content/agent_workflows.tsx`
- `docs_site/src/content/current_contracts.tsx`
- `apps/workbench-ui/src/components/DocsViewer.tsx`
- `docs_site/src/pages/docsPages.ts`
- `README.md`
- `bugs_and_fixes/regression_tests.md`
- `bugs_and_fixes/agent_error_patterns.md`
- `scripts/dev/check_repo_conventions.sh`

Tasks:

- Update user-facing docs to describe actual tool construction and execution.
- Add examples for a data importer, diagnostic with plot, diagram-producing
  validation tool, and export tool.
- Add regression entries for schema/UI drift and unbound construction surfaces.
- Add convention checks for the skill package, tool schema, API routes, UI
  panels, tests, and docs metadata.
- Run the current-contract language scanner after docs updates.

Acceptance:

- Docs describe current behavior, not historical closure notes.
- The UI docs browser metadata includes any new docs page.
- Hard gate runs Python tests, secure-core tests where changed, UI typecheck,
  Vitest, convention checker, and current-contract scanner.

---

## Approval Points

The following decisions should be approved before implementation:

1. **Repo-local skill path.** Default proposal:
   `.agents/skills/simworkbench-tool-construction/`.
2. **Skill installation approach.** Default proposal: a copy/symlink installer
   script for local agent runtimes, not automatic mutation of user home dirs.
3. **Tool metadata extension shape.** Default proposal: add `io`,
   `permissions`, `ui`, and `artifacts` sections under strict Pydantic models.
4. **Tool run model.** Default proposal: async-capable run manager with
   synchronous compatibility wrapper for small local tools.
5. **Diagram format.** Default proposal: structured JSON render specs only;
   no raw HTML, arbitrary SVG, or executable diagram payloads.
6. **Secure route target.** Default proposal: workspace-scoped secure-core run
   routes become the deployed contract; local `/api/tools` remains a dev/local
   compatibility layer.

## Definition of Done

This initiative is complete when:

- A repo-local tool-construction skill exists, validates, and can be installed
  into the local agent runtime on demand.
- A new internal tool can be created from template, checked by the skill script,
  registered, tested, run from UI, rendered in UI, exported, documented, and
  lifecycle-gated without manual patching.
- Tool UI binding works for at least one table-producing tool and one
  diagram-producing tool.
- Tool outputs are artifact-backed when too large or file-like, and every
  artifact carries provenance and hash metadata.
- Secure multi-user routes enforce workspace scoping, capability checks,
  approval checks, quota reservation, sandboxing, and audit/provenance events.
- Docs, examples, tests, convention checks, bug memory, and current-contract
  scanner coverage all reflect the shipped behavior.


/**
 * Typed HTTP client for the workbench backend API (Phase 1F).
 *
 * Single source of API types. Components import the request/response shapes
 * from here so that the API contract is enforced at the type level.
 *
 * Phase 0.5 / Phase F-rest-final (2026-05-09): every request flows
 * through the auth gateway. ``fetchJson`` therefore:
 *   1. sets ``credentials: "include"`` so the session + CSRF cookies
 *      ride along on every call;
 *   2. echoes the ``X-CSRF-Token`` header on state-changing methods
 *      using the shared CSRF helper;
 *   3. prefixes the active workspace slug
 *      (``/api/:slug/...``) when one is set on the workspace context.
 */

import { methodRequiresCsrf, readCsrfCookieValue } from "./csrf.js";
import { getCurrentWorkspaceSlug } from "./workspaceContext.js";

export interface RunSummary {
  run_id: string;
  state: string;
  elapsed_seconds: number;
  final_simulation_time: number;
  diagnostics_keys: string[];
  /**
   * True when one or more interactions used a flagged-placeholder rate
   * constant. The UI must surface this so the user knows the run is
   * exploratory unless separate validation evidence upgrades the result.
   */
  placeholder_used: boolean;
  placeholders: string[];
}

export interface StartRunRequest {
  model_yaml_path: string;
  end_time?: string;
  max_steps?: number;
  seed?: number;
}

export interface DiagnosticSeries {
  run_id: string;
  name: string;
  times: number[];
  values: number[];
}

export interface DocsPage {
  slug: string;
  title: string;
  path: string;
}

export interface CapsuleEntry {
  name: string;
  path: string;
}

/**
 * Phase 2D — capsule inspection types. Mirrors the FastAPI server
 * responses one-to-one so the contract is enforced at the type level.
 */
export interface CapsuleSubtreeEntry {
  name: string;
  kind: "dir" | "file";
  entries?: number;
  size_bytes?: number;
}

export interface CapsuleManifestSection {
  [key: string]: unknown;
}

export interface CapsuleDetail {
  name: string;
  path: string;
  manifest: {
    capsule?: CapsuleManifestSection;
    paper?: CapsuleManifestSection;
    model?: CapsuleManifestSection;
    runtime?: CapsuleManifestSection;
    provenance?: CapsuleManifestSection;
  } | null;
  manifest_error: string | null;
  subtrees: CapsuleSubtreeEntry[];
}

export interface CapsuleFile {
  name: string;
  path: string;
  size_bytes: number;
  content: string;
}

export interface CapsuleViolation {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: string | null;
}

export interface CapsuleValidation {
  name: string;
  ok: boolean;
  violations: CapsuleViolation[];
  errors: string[];
  warnings: string[];
}

export interface CapsuleDiagnostics {
  name: string;
  source: "h5" | "json";
  series: Record<string, number[]>;
}

export interface CapsuleTreeFile {
  path: string;
  size_bytes: number;
}

export interface CapsuleTree {
  name: string;
  subtree: string;
  files: CapsuleTreeFile[];
}

/**
 * Phase 3D — Tool registry types. Mirrors the FastAPI server one-to-one.
 */
export type ToolStatus =
  | "draft"
  | "candidate"
  | "validated"
  | "trusted"
  | "deprecated";

export interface ToolIndexRow {
  name: string;
  type: string;
  version: string;
  status: ToolStatus;
  directory: string;
}

export interface ToolPort {
  name: string;
  type: string;
  units?: string | null;
  description?: string;
}

export interface ToolMetadata {
  name: string;
  version: string;
  type: string;
  description: string;
  author: string;
  status: ToolStatus;
  entrypoint: string;
  inputs: ToolPort[];
  outputs: ToolPort[];
  compatible_domains: string[];
  requires: { python: string[]; system: string[] };
  validation: { tests: string[]; reference_cases: string[] };
}

export interface ToolDetail {
  name: string;
  directory: string;
  metadata: ToolMetadata;
}

export interface ToolDocs {
  name: string;
  readme: string;
  tool_yaml: string;
}

/**
 * Cross-workspace tool promotion — Phase α.4 (2026-05-10).
 *
 * Mirrors ``packages/core/src/simworkbench/tools/promotion.py``'s
 * ``PromotionRequest`` dataclass. The backend persists each record
 * under ``local_cache/imported_tools/_pending_promotions/{request_id}.json``;
 * ``status`` advances ``pending → approved | denied`` via the
 * approver endpoints.
 */
export type ToolPromotionStatus = "pending" | "approved" | "denied";

export interface ToolPromotionRequest {
  request_id: string;
  tool_name: string;
  from_workspace_slug: string;
  to_workspace_slug: string;
  requested_by: string;
  requested_at: string;
  justification: string;
  status: ToolPromotionStatus;
  decided_by?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
}

export interface ToolPromoteRequestBody {
  to_workspace_slug: string;
  justification?: string;
}

export interface ToolPromotionDecisionBody {
  decision_note?: string;
}

export interface ToolAuthoringTemplate {
  template_id: string;
  title: string;
  description: string;
  type: string;
  editable_files: string[];
  required_files: string[];
}

export type ToolAuthoringCodeTemplateCategory =
  | "visualization"
  | "ode_solver"
  | "diagram"
  | "data_importer"
  | "diagnostic"
  | "utility";

export type ToolAuthoringPreviewHarness =
  | "python_smoke"
  | "ode_solver"
  | "visualization"
  | "diagram"
  | "data_transform";

export interface ToolAuthoringCodeTemplate {
  template_id: string;
  title: string;
  description: string;
  category: ToolAuthoringCodeTemplateCategory;
  language: "python" | "text" | string;
  target_path: string;
  preview_harness: ToolAuthoringPreviewHarness;
  source: "built_in" | "workspace" | "imported" | string;
  readonly: boolean;
  content: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface ToolAuthoringCodeTemplateBody {
  title: string;
  description: string;
  category: ToolAuthoringCodeTemplateCategory;
  target_path: string;
  content: string;
  preview_harness: ToolAuthoringPreviewHarness;
}

export interface ToolAuthoringTemplateApplication {
  draft: ToolAuthoringDraft;
  applied_template: ToolAuthoringCodeTemplate;
  path: string;
}

export interface ToolAuthoringDraftFile {
  path: string;
  size_bytes: number;
  editable: boolean;
}

export interface ToolAuthoringCheckIssue {
  severity: "error" | "warning";
  location: string;
  message: string;
}

export interface ToolAuthoringCheckResult {
  passed: boolean;
  returncode: number;
  stdout: string;
  stderr: string;
  issues: ToolAuthoringCheckIssue[];
  checked_at: string;
  content_hash: string;
}

export interface ToolAuthoringDraft {
  draft_id: string;
  workspace_id: string;
  tool_name: string;
  template_id: string;
  status: "draft" | "checked" | "registered";
  draft_root: string;
  content_hash: string;
  manifest_ok: boolean;
  manifest_errors: string[];
  files: ToolAuthoringDraftFile[];
  last_check: ToolAuthoringCheckResult | null;
  registered_tool: { name: string; directory: string; registered_at: string } | null;
  created_at: string;
  updated_at: string;
}

export interface ToolAuthoringFile {
  draft_id: string;
  path: string;
  content: string;
  editable: boolean;
  size_bytes: number;
}

export interface ToolAuthoringManifestResult {
  draft_id: string;
  ok: boolean;
  errors: string[];
  metadata?: ToolMetadata;
}

export interface ToolAuthoringRegistration {
  draft_id: string;
  name: string;
  directory: string;
}

export interface ToolAuthoringExport {
  draft_id: string;
  archive: string;
  size_bytes: number;
}

export interface ToolAuthoringDeleteResult {
  draft_id?: string;
  template_id?: string;
  deleted: boolean;
}

export interface ToolAuthoringPreviewResult {
  preview_id: string;
  draft_id: string;
  harness: ToolAuthoringPreviewHarness;
  passed: boolean;
  returncode: number;
  stdout: string;
  stderr: string;
  outputs: ToolRunOutput[];
  artifacts: ToolArtifactRef[];
  diagnostics?: string[];
  elapsed_ms: number;
  content_hash: string;
  preview_root?: string;
}

export type ToolInputKind =
  | "scalar"
  | "array"
  | "table"
  | "string"
  | "bool"
  | "enum"
  | "file"
  | "capsule";

export type ToolOutputKind =
  | "scalar"
  | "table"
  | "timeseries"
  | "heatmap"
  | "particle_scatter"
  | "image"
  | "diagram"
  | "file"
  | "report"
  | "json";

export interface ToolTableColumn {
  name: string;
  type?: string;
  units?: string | null;
  required?: boolean;
  description?: string;
}

export interface ToolInputSchema {
  name: string;
  kind: ToolInputKind;
  type: string;
  units?: string | null;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum_values?: string[];
  widget?: "text" | "textarea" | "number" | "checkbox" | "select" | "json" | "artifact";
  columns?: ToolTableColumn[];
}

export interface ToolOutputSchema {
  name: string;
  kind: ToolOutputKind;
  type: string;
  units?: string | null;
  description?: string;
  renderer?: ToolOutputKind | "graph" | "flow" | "schema" | "pipeline";
  columns?: ToolTableColumn[];
}

export interface ToolPermissionSummary {
  filesystem?: "none" | "read_artifacts" | "write_artifacts";
  network?: "none" | "proxy_required";
  high_risk_actions?: string[];
}

export interface ToolSchemaResponse {
  name: string;
  version: string;
  type: string;
  status: ToolStatus;
  description: string;
  inputs: ToolInputSchema[];
  outputs: ToolOutputSchema[];
  permissions?: ToolPermissionSummary;
  ui?: Record<string, unknown>;
}

export interface ToolDataMapping {
  source_artifact_id?: string;
  source_path?: string;
  columns?: Record<string, string>;
  format?: "csv" | "json" | "inline" | "artifact";
}

export interface ToolRunRequest {
  inputs: Record<string, unknown>;
  units?: Record<string, string>;
  data_mappings?: Record<string, ToolDataMapping>;
}

export interface ToolPreviewRequest extends ToolRunRequest {}

export interface ToolValidationMessage {
  severity: "error" | "warning" | "info";
  field?: string;
  message: string;
}

export interface ToolArtifactRef {
  artifact_id: string;
  name: string;
  kind: ToolOutputKind;
  mime_type?: string;
  size_bytes?: number;
  content_hash?: string;
  preview?: unknown;
}

export interface ToolPreviewResponse {
  name: string;
  ok: boolean;
  validation: ToolValidationMessage[];
  planned_artifacts: ToolArtifactRef[];
  permissions?: ToolPermissionSummary;
  normalized_inputs?: Record<string, unknown>;
}

export interface ToolRunOutput {
  name: string;
  kind: ToolOutputKind;
  value?: unknown;
  units?: string | null;
  artifact_id?: string;
  mime_type?: string;
  renderer?: ToolOutputSchema["renderer"];
}

export interface ToolRunResponse {
  name: string;
  run_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  outputs: ToolRunOutput[];
  artifacts: ToolArtifactRef[];
  validation: ToolValidationMessage[];
  logs: string[];
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
}

export interface ToolArtifactPreview {
  artifact_id: string;
  name: string;
  kind: ToolOutputKind;
  mime_type?: string;
  size_bytes?: number;
  content_hash?: string;
  preview: unknown;
}

const DEFAULT_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly responseText: string;

  constructor(path: string, status: number, responseText: string) {
    super(`API ${path} failed with ${status}: ${responseText}`);
    this.name = "ApiError";
    this.status = status;
    this.responseText = responseText;
  }
}

/**
 * Build the URL for a request. When a workspace slug is active,
 * paths under the ``baseUrl`` of ``/api`` are routed through
 * ``/api/:slug/...`` so the gateway can authorize the call against
 * the user's membership. When no slug is set (boot, raw-component
 * tests), the URL falls back to the unprefixed shape so the small
 * set of non-workspace endpoints keeps working.
 *
 * Note: prefixing only applies when ``baseUrl`` matches the default
 * ``/api`` mount. Callers that pass an absolute or alternate base
 * (e.g. a stub server) bypass the prefix entirely.
 */
function buildRequestUrl(path: string, baseUrl: string): string {
  if (baseUrl !== DEFAULT_BASE) return baseUrl + path;
  const slug = getCurrentWorkspaceSlug();
  if (slug === null) return baseUrl + path;
  // Path always begins with "/" by convention; defensively normalize.
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}/${slug}${normalizedPath}`;
}

async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  baseUrl: string = DEFAULT_BASE,
): Promise<T> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  // Echo the CSRF synchronizer cookie on state-changing requests.
  // Same shape as secureCoreClient.ts so a single audit covers both
  // clients (v4 §7.2 double-submit).
  if (methodRequiresCsrf(init?.method)) {
    const token = readCsrfCookieValue();
    if (token.length > 0 && !("X-CSRF-Token" in headers)) {
      headers["X-CSRF-Token"] = token;
    }
  }
  const url = buildRequestUrl(path, baseUrl);
  const r = await fetch(url, {
    credentials: "include",
    ...(init ?? {}),
    headers,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new ApiError(path, r.status, text);
  }
  return (await r.json()) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolSchemaResponse(value: unknown): value is ToolSchemaResponse {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    typeof value.type === "string" &&
    typeof value.status === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.inputs) &&
    Array.isArray(value.outputs)
  );
}

function isToolStatus(value: unknown): value is ToolStatus {
  return (
    value === "draft" ||
    value === "candidate" ||
    value === "validated" ||
    value === "trusted" ||
    value === "deprecated"
  );
}

function isToolPortList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((port) => {
      if (!isRecord(port)) return false;
      return typeof port.name === "string" && typeof port.type === "string";
    })
  );
}

function isToolDetailResponse(value: unknown): value is ToolDetail {
  if (!isRecord(value) || !isRecord(value.metadata)) return false;
  const metadata = value.metadata;
  return (
    typeof value.name === "string" &&
    typeof value.directory === "string" &&
    typeof metadata.name === "string" &&
    typeof metadata.version === "string" &&
    typeof metadata.type === "string" &&
    isToolStatus(metadata.status) &&
    typeof metadata.description === "string" &&
    typeof metadata.entrypoint === "string" &&
    isToolPortList(metadata.inputs) &&
    isToolPortList(metadata.outputs) &&
    isRecord(metadata.validation) &&
    Array.isArray(metadata.validation.tests) &&
    Array.isArray(metadata.validation.reference_cases)
  );
}

function inputKindFromPortType(type: string): ToolInputKind {
  const normalized = type.toLowerCase();
  if (normalized.includes("bool")) return "bool";
  if (normalized.includes("enum")) return "enum";
  if (normalized.includes("table")) return "table";
  if (normalized.includes("array") || normalized.includes("vector") || normalized.includes("list")) return "array";
  if (normalized.includes("file") || normalized.includes("artifact")) return "file";
  if (normalized.includes("capsule")) return "capsule";
  if (normalized.includes("string") || normalized.includes("text")) return "string";
  return "scalar";
}

function outputKindFromPortType(type: string): ToolOutputKind {
  const normalized = type.toLowerCase();
  if (normalized.includes("table")) return "table";
  if (normalized.includes("timeseries") || normalized.includes("series")) return "timeseries";
  if (normalized.includes("heatmap")) return "heatmap";
  if (normalized.includes("scatter") || normalized.includes("particle")) return "particle_scatter";
  if (normalized.includes("image") || normalized.includes("figure")) return "image";
  if (normalized.includes("diagram") || normalized.includes("graph") || normalized.includes("flow")) return "diagram";
  if (normalized.includes("file") || normalized.includes("artifact")) return "file";
  if (normalized.includes("report") || normalized.includes("markdown")) return "report";
  if (normalized.includes("json") || normalized.includes("object")) return "json";
  return "scalar";
}

function schemaFromToolDetail(detail: ToolDetail): ToolSchemaResponse {
  if (!isToolDetailResponse(detail)) {
    throw new Error("Malformed tool detail response from backend.");
  }
  const metadata = detail.metadata;
  return {
    name: metadata.name,
    version: metadata.version,
    type: metadata.type,
    status: metadata.status,
    description: metadata.description,
    inputs: metadata.inputs.map((input) => ({
      name: input.name,
      kind: inputKindFromPortType(input.type),
      type: input.type,
      units: input.units ?? null,
      description: input.description,
      required: true,
    })),
    outputs: metadata.outputs.map((output) => ({
      name: output.name,
      kind: outputKindFromPortType(output.type),
      type: output.type,
      units: output.units ?? null,
      description: output.description,
      renderer: outputKindFromPortType(output.type),
    })),
    permissions: {
      filesystem: "none",
      network: "none",
      high_risk_actions: [],
    },
    ui: {
      source: "legacy_tool_metadata",
    },
  };
}

function isMissingEndpoint(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}

function fallbackPreview(schema: ToolSchemaResponse, request: ToolPreviewRequest): ToolPreviewResponse {
  const validation: ToolValidationMessage[] = [];
  for (const input of schema.inputs) {
    const value = request.inputs[input.name];
    const emptyString = typeof value === "string" && value.trim() === "";
    if (input.required !== false && (value === undefined || value === null || emptyString)) {
      validation.push({
        severity: "error",
        field: input.name,
        message: `${input.name} is required before execution.`,
      });
    }
  }
  validation.push({
    severity: "warning",
    message: "Backend preview endpoint is unavailable; this is a client-side contract preview with no side effects.",
  });
  return {
    name: schema.name,
    ok: !validation.some((message) => message.severity === "error"),
    validation,
    normalized_inputs: request.inputs,
    permissions: schema.permissions,
    planned_artifacts: schema.outputs
      .filter((output) => output.kind !== "scalar")
      .map((output) => ({
        artifact_id: `planned:${schema.name}:${output.name}`,
        name: output.name,
        kind: output.kind,
        mime_type: output.kind === "table" || output.kind === "json" || output.kind === "diagram" ? "application/json" : undefined,
      })),
  };
}

function normalizeLegacyExecuteResponse(
  name: string,
  schema: ToolSchemaResponse,
  output: Record<string, unknown>,
): ToolRunResponse {
  const outputs = Object.entries(output).map(([outputName, value]) => {
    const declared = schema.outputs.find((candidate) => candidate.name === outputName);
    let actualValue = value;
    let units = declared?.units ?? null;
    if (isRecord(value) && "magnitude" in value && "units" in value) {
      actualValue = value.magnitude;
      units = typeof value.units === "string" ? value.units : units;
    }
    return {
      name: outputName,
      kind: declared?.kind ?? outputKindFromPortType(typeof actualValue),
      value: actualValue,
      units,
      renderer: declared?.renderer,
    } satisfies ToolRunOutput;
  });

  return {
    name,
    run_id: "legacy-execute",
    status: "completed",
    outputs,
    artifacts: [],
    validation: [
      {
        severity: "info",
        message: "Tool executed through the legacy synchronous execute endpoint; run artifacts are unavailable.",
      },
    ],
    logs: ["POST /api/tools/{name}/execute completed."],
    started_at: null,
    completed_at: null,
    error: null,
  };
}

function artifactArrayFromPayload(payload: unknown): ToolArtifactRef[] {
  if (Array.isArray(payload)) return payload as ToolArtifactRef[];
  if (isRecord(payload) && Array.isArray(payload.artifacts)) {
    return payload.artifacts as ToolArtifactRef[];
  }
  return [];
}

function normalizeRunPayload(
  payload: unknown,
  schema?: ToolSchemaResponse,
): ToolRunResponse {
  if (
    isRecord(payload) &&
    typeof payload.name === "string" &&
    typeof payload.run_id === "string" &&
    typeof payload.status === "string" &&
    Array.isArray(payload.outputs)
  ) {
    return {
      name: payload.name,
      run_id: payload.run_id,
      status: payload.status as ToolRunResponse["status"],
      outputs: payload.outputs as ToolRunOutput[],
      artifacts: artifactArrayFromPayload(payload.artifacts),
      validation: Array.isArray(payload.validation)
        ? (payload.validation as ToolValidationMessage[])
        : [],
      logs: Array.isArray(payload.logs)
        ? payload.logs.filter((line): line is string => typeof line === "string")
        : [],
      started_at: typeof payload.started_at === "string" ? payload.started_at : null,
      completed_at: typeof payload.completed_at === "string" ? payload.completed_at : null,
      error: typeof payload.error === "string" ? payload.error : null,
    };
  }

  if (
    isRecord(payload) &&
    typeof payload.run_id === "string" &&
    typeof payload.tool_name === "string" &&
    typeof payload.status === "string"
  ) {
    const inlineOutput = isRecord(payload.inline_output) ? payload.inline_output : {};
    const artifacts = artifactArrayFromPayload(payload.artifacts);
    const outputs: ToolRunOutput[] = [];
    for (const [name, value] of Object.entries(inlineOutput)) {
      const declared = schema?.outputs.find((candidate) => candidate.name === name);
      outputs.push({
        name,
        kind: declared?.kind ?? outputKindFromPortType(typeof value),
        value,
        units: declared?.units ?? null,
        renderer: declared?.renderer,
      });
    }
    for (const artifact of artifacts) {
      const declared = schema?.outputs.find((candidate) => candidate.name === artifact.name);
      outputs.push({
        name: artifact.name,
        kind: artifact.kind,
        value: artifact.preview,
        artifact_id: artifact.artifact_id,
        mime_type: artifact.mime_type,
        renderer: declared?.renderer,
      });
    }
    return {
      name: payload.tool_name,
      run_id: payload.run_id,
      status: payload.status as ToolRunResponse["status"],
      outputs,
      artifacts,
      validation:
        payload.status === "failed"
          ? [{
              severity: "error",
              message: typeof payload.error === "string" ? payload.error : "Tool run failed.",
            }]
          : [],
      logs: [`run ${payload.status}`],
      started_at: typeof payload.started_at === "string" ? payload.started_at : null,
      completed_at: typeof payload.completed_at === "string" ? payload.completed_at : null,
      error: typeof payload.error === "string" ? payload.error : null,
    };
  }

  throw new Error("Tool run response did not match a supported shape.");
}

export interface ApiClient {
  health(): Promise<{ ok: boolean; version: string }>;
  listRuns(): Promise<RunSummary[]>;
  startRun(req: StartRunRequest): Promise<RunSummary>;
  getRun(runId: string): Promise<RunSummary>;
  getDiagnostic(runId: string, name: string): Promise<DiagnosticSeries>;
  listDocsPages(): Promise<DocsPage[]>;
  listCapsules(): Promise<CapsuleEntry[]>;
  listTempRuns(): Promise<CapsuleEntry[]>;
  getCapsule(name: string): Promise<CapsuleDetail>;
  getCapsuleFile(name: string, path: string): Promise<CapsuleFile>;
  getCapsuleTree(name: string, subtree?: string): Promise<CapsuleTree>;
  validateCapsule(name: string): Promise<CapsuleValidation>;
  getCapsuleDiagnostics(name: string): Promise<CapsuleDiagnostics>;
  listTools(): Promise<ToolIndexRow[]>;
  getTool(name: string): Promise<ToolDetail>;
  getToolDocs(name: string): Promise<ToolDocs>;
  listToolAuthoringTemplates(): Promise<ToolAuthoringTemplate[]>;
  listToolAuthoringCodeTemplates(): Promise<ToolAuthoringCodeTemplate[]>;
  createToolAuthoringCodeTemplate(body: ToolAuthoringCodeTemplateBody): Promise<ToolAuthoringCodeTemplate>;
  importToolAuthoringCodeTemplate(body: ToolAuthoringCodeTemplateBody): Promise<ToolAuthoringCodeTemplate>;
  deleteToolAuthoringCodeTemplate(templateId: string): Promise<ToolAuthoringDeleteResult>;
  createToolDraft(templateId: string, name: string): Promise<ToolAuthoringDraft>;
  listToolDrafts(): Promise<ToolAuthoringDraft[]>;
  getToolDraft(draftId: string): Promise<ToolAuthoringDraft>;
  deleteToolDraft(draftId: string): Promise<ToolAuthoringDeleteResult>;
  readToolDraftFile(draftId: string, path: string): Promise<ToolAuthoringFile>;
  writeToolDraftFile(draftId: string, path: string, content: string): Promise<ToolAuthoringDraft>;
  applyToolAuthoringCodeTemplate(
    draftId: string,
    templateId: string,
    targetPath?: string,
  ): Promise<ToolAuthoringTemplateApplication>;
  previewToolDraft(draftId: string, harness: ToolAuthoringPreviewHarness): Promise<ToolAuthoringPreviewResult>;
  validateToolDraftManifest(draftId: string): Promise<ToolAuthoringManifestResult>;
  checkToolDraft(draftId: string): Promise<ToolAuthoringCheckResult>;
  registerToolDraft(draftId: string): Promise<ToolAuthoringRegistration>;
  exportToolDraft(draftId: string): Promise<ToolAuthoringExport>;
  getToolSchema(name: string): Promise<ToolSchemaResponse>;
  previewTool(name: string, body: ToolPreviewRequest): Promise<ToolPreviewResponse>;
  runTool(name: string, body: ToolRunRequest): Promise<ToolRunResponse>;
  getToolRun(name: string, runId: string): Promise<ToolRunResponse>;
  listToolArtifacts(name: string, runId: string): Promise<ToolArtifactRef[]>;
  getToolArtifact(artifactId: string): Promise<ToolArtifactPreview>;
  /**
   * Promote/demote a tool. The backend chooses the actor server-side:
   * agent-allowed transitions (draft / candidate / deprecated) run as
   * `agent`; human-only transitions (validated / trusted) require a
   * pre-written approval token under `local_cache/tool_approvals/`.
   * Earlier the API trusted a client-supplied `actor` field; carries
   * `agent_error_patterns.md` "Trusting a client-supplied actor
   * identity for a privileged check".
   */
  setToolStatus(name: string, status: ToolStatus): Promise<{ name: string; status: ToolStatus }>;
  runToolTests(name: string): Promise<{ name: string; passed: boolean; returncode: number; stdout: string; stderr: string }>;
  executeTool(name: string, kwargs: Record<string, unknown>, units?: Record<string, string>): Promise<{ name: string; output: Record<string, unknown> }>;
  exportTool(name: string): Promise<{ name: string; archive: string; size_bytes: number }>;
  importTool(sourcePath: string, targetName: string): Promise<{ name: string; directory: string }>;
  /**
   * Cross-workspace promotion — Phase α.4 (2026-05-10). Requires
   * ``tool:request_promotion`` capability (WorkspaceAdmin). Creates
   * a pending record; PlatformAdmin approves via ``approveToolPromotion``.
   */
  requestToolPromotion(
    name: string,
    body: ToolPromoteRequestBody,
  ): Promise<ToolPromotionRequest>;
  listToolPromotions(): Promise<ToolPromotionRequest[]>;
  approveToolPromotion(
    requestId: string,
    body: ToolPromotionDecisionBody,
  ): Promise<ToolPromotionRequest>;
  denyToolPromotion(
    requestId: string,
    body: ToolPromotionDecisionBody,
  ): Promise<ToolPromotionRequest>;
  importPaper(capsule: string, sourcePath: string): Promise<PaperImportResult>;
  getPaperExtracted(capsule: string): Promise<PaperExtracted>;
  editPaperArtifact(capsule: string, body: PaperEditPayload): Promise<{ capsule: string; ok: boolean }>;
  createProposal(capsule: string): Promise<ProposalResult>;
  /**
   * Phase 6 — Sandboxed Agentic Code Generation. The codegen endpoints
   * write only to ``<capsule>/src/generated/`` and never touch
   * ``<capsule>/src/user_edits/``. The backend enforces this
   * unconditionally; the UI carries no toggle.
   */
  listCodegen(capsule: string): Promise<CodegenListing>;
  runCodegen(capsule: string): Promise<CodegenRun>;
  diffCodegen(capsule: string): Promise<CodegenDiff>;
  runValidation(capsule: string): Promise<{ capsule: string; summary_path: string }>;
  /**
   * Phase 6D editor — write reviewer-controlled content to
   * `<capsule>/src/user_edits/<path>`. Backend refuses any path
   * outside that subtree (the library's `user_edit_write` enforces
   * the allow-list). Empty paths return 400.
   */
  writeUserEdit(
    capsule: string,
    path: string,
    content: string,
  ): Promise<{ capsule: string; path: string; size_bytes: number }>;
  /**
   * Browse one of the allow-listed roots (`simulation_capsules`,
   * `temp_runs`, `local_cache`, `temp_imports`, `examples`). `path`
   * is repo-root-relative within the chosen root; pass empty string
   * for the root itself. Server validates `..` / symlink escapes.
   */
  browse(args: BrowseArgs, signal?: AbortSignal): Promise<BrowseResponse>;

  /**
   * List the runnable examples discovered under `examples/`. Each entry
   * carries enough metadata for the UI to render a card + Run button
   * without the user knowing whether it's ModelSpec-driven or script-
   * driven.
   */
  listExamples(): Promise<ExampleSummary[]>;

  /**
   * Run a discovered example end-to-end. Returns the run_id + summary +
   * capsule paths (when present) so the UI can link the user to the
   * resulting artifact.
   */
  runExample(name: string): Promise<RunExampleResponse>;

  /**
   * Phase 9 / 9D — read a sweep capsule's comparison report manifest.
   * The Python reporter (`simworkbench.reports.ComparisonReport`)
   * writes `manifest.json` under the capsule; this endpoint surfaces
   * it. Returns 404 if the capsule has no comparison artifact yet.
   */
  getComparisonReport(capsule: string): Promise<ComparisonManifest>;

  /**
   * Phase 10 / 10A — run ExperimentDesigner on a capsule's ModelSpec.
   * Returns the structured plan; never mutates the capsule.
   * (`experiment_design` agent role — see configs/agents.yaml.)
   */
  designExperiment(capsule: string): Promise<AutonomyDesignResponse>;

  /**
   * Phase 10 / 10B — run a smoke pass against the capsule. Returns the
   * agent's diagnostics interpretation + instability flags +
   * suggested adjustments. The server logs the action to the capsule's
   * provenance/agent_trace.md.
   */
  smokeExperiment(capsule: string): Promise<AutonomySmokeResponse>;

  /**
   * Phase 10 / 10D — run ScientificReviewer on the capsule. Writes
   * `<capsule>/review/scientific_review.md` and returns the path.
   * (`scientific_review` agent role.)
   */
  reviewExperiment(capsule: string): Promise<AutonomyReviewResponse>;

  /**
   * Phase 10 / 10C — run a budget-bounded sweep via the
   * `controlled_sweep` agent. The body carries the parameter grid +
   * metric name; the budget is server-side (configs/agents.yaml).
   * The `orchestrator` agent role co-ordinates the autonomous loop.
   */
  autonomousSweep(capsule: string, body: AutonomySweepBody): Promise<AutonomySweepResponse>;
}

export interface AutonomyFidelityStep {
  label: string;
  description: string;
  cpu_cost_factor: number;
}

export interface AutonomyDesignResponse {
  capsule: string;
  minimum_viable_model: string;
  fidelity_ladder: AutonomyFidelityStep[];
  cost_estimate: {
    total_cpu_seconds: number;
    backend: string;
    notes: string;
  };
  diagnostics: string[];
  validation_path: string[];
  placeholders: string[];
  capsule_status: "exploratory" | "validated";
}

export interface AutonomyReviewResponse {
  capsule: string;
  review_path: string;
}

export interface AutonomySmokeResponse {
  capsule: string;
  diagnostics_interpretation: Record<string, string>;
  instability_flags: string[];
  suggested_param_adjustments: string[];
  review_markdown: string;
}

export interface AutonomySweepBody {
  parameters: Record<string, number[]>;
  metric?: string;
  name?: string;
}

export interface AutonomySweepResponse {
  capsule: string;
  trend_summary: string;
  next_sweep_recommendation: string;
  failure_ratio: number;
  completed: number;
  failed: number;
  stopped_reason: string;
}

/**
 * Browse-able roots. The TS literal type mirrors the server-side
 * allow-list in `simworkbench.api.server._BROWSE_ROOTS`. Adding a
 * root requires a server change first, then this list.
 */
export const BROWSE_ROOTS = [
  "simulation_capsules",
  "temp_runs",
  "local_cache",
  "temp_imports",
  "examples",
] as const;

export type BrowseRoot = (typeof BROWSE_ROOTS)[number];

export interface BrowseArgs {
  readonly root: BrowseRoot;
  readonly path?: string;
}

/**
 * Discriminated union: directories don't carry size/mtime in the
 * common case, files always do.
 */
export type BrowseEntry =
  | {
      readonly kind: "dir";
      readonly name: string;
      readonly path: string;
      readonly size_bytes: null;
      readonly mtime_iso: string | null;
    }
  | {
      readonly kind: "file";
      readonly name: string;
      readonly path: string;
      readonly size_bytes: number;
      readonly mtime_iso: string | null;
    };

export interface BrowseResponse {
  readonly root: BrowseRoot;
  readonly relative_path: string;
  readonly parent_relative_path: string | null;
  readonly entries: readonly BrowseEntry[];
  readonly truncated: boolean;
}

export interface ExampleSummary {
  name: string;
  kind: "modelspec" | "script";
  description: string;
  has_model_yaml: boolean;
  readme_path: string;
  run_path: string;
  model_yaml_path: string | null;
}

export interface RunExampleResponse {
  name: string;
  run_id: string | null;
  summary_path: string | null;
  capsule_name: string | null;
  stdout_tail: string;
  duration_seconds: number;
}

export interface ComparisonRankRow {
  rank: number;
  parameters: Record<string, number>;
  metrics: Record<string, number | string>;
}

export interface ComparisonManifest {
  title: string;
  sweep_id: string;
  spec_name: string;
  metric: string;
  lower_is_better: boolean;
  n_completed: number;
  n_failed: number;
  stopped_reason: string;
  ranking: ComparisonRankRow[];
}

export interface CodegenFile {
  path: string;
  size_bytes: number;
}

export interface CodegenManifestEntry {
  path: string;
  sha256: string;
}

export interface CodegenManifest {
  generated_at: string;
  workbench_version: string;
  spec_name: string;
  spec_domain: string;
  files: CodegenManifestEntry[];
}

export interface CodegenListing {
  capsule: string;
  generated_files: CodegenFile[];
  user_edits_files: CodegenFile[];
  manifest: CodegenManifest | null;
}

export interface CodegenRun {
  capsule: string;
  files_written: string[];
  files_removed: string[];
  manifest_path: string | null;
}

export interface CodegenDiff {
  capsule: string;
  previous: CodegenManifest | null;
  current_preview: CodegenManifestEntry[];
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
  note?: string;
}

export interface ProposalMatchRow {
  name: string;
  domain: string;
  version: string;
  score: number;
  sub_scores: Record<string, number>;
  reasons: string[];
  directory: string;
}

export interface ProposalGaps {
  missing_modules: string[];
  missing_data: string[];
  unsupported_regimes: string[];
  invalid_solver_choices: string[];
  validation_gaps: string[];
}

export interface ProposalResult {
  capsule: string;
  proposal_path: string;
  modelspec_path: string;
  matches: { matches: ProposalMatchRow[]; unmatched_requirements: string[] };
  gaps: ProposalGaps;
}

export interface PaperImportResult {
  capsule: string;
  paper_imported: string;
  equations_path: string;
  parameters_path: string;
  interpretation_files: string[];
}

export interface PaperEquation {
  id: string;
  text: string;
  latex: string;
  source_line: number;
  source_file: string;
  confidence: number;
  edited_by: string;
  notes: string;
}

export interface PaperParameter {
  name: string;
  value: number | string;
  unit: string;
  missing_units: boolean;
  source_line: number;
  source_file: string;
  confidence: number;
  edited_by: string;
  notes: string;
}

export interface PaperInterpretation {
  paper_summary: string;
  assumptions: string;
  validity_domain: string;
  implementation_plan: string;
}

export interface PaperExtracted {
  equations: PaperEquation[];
  parameters: PaperParameter[];
  interpretation: PaperInterpretation;
}

export interface PaperEditPayload {
  artifact: "equations" | "parameters" | "interpretation";
  index: number;
  field: string;
  value: unknown;
  reviewer: string;
}

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function createApiClient(baseUrl: string = DEFAULT_BASE): ApiClient {
  const getToolSchema = async (name: string): Promise<ToolSchemaResponse> => {
    try {
      const payload = await fetchJson<unknown>(
        `/tools/${encodeURIComponent(name)}/schema`,
        undefined,
        baseUrl,
      );
      if (isToolSchemaResponse(payload)) return payload;
      const detail = await fetchJson<ToolDetail>(
        `/tools/${encodeURIComponent(name)}`,
        undefined,
        baseUrl,
      );
      return schemaFromToolDetail(detail);
    } catch (error) {
      if (!isMissingEndpoint(error)) throw error;
      const detail = await fetchJson<ToolDetail>(
        `/tools/${encodeURIComponent(name)}`,
        undefined,
        baseUrl,
      );
      return schemaFromToolDetail(detail);
    }
  };

  return {
    health: () => fetchJson("/health", undefined, baseUrl),
    listRuns: () => fetchJson("/runs", undefined, baseUrl),
    startRun: (req) =>
      fetchJson("/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      }, baseUrl),
    getRun: (runId) => fetchJson(`/runs/${encodeURIComponent(runId)}`, undefined, baseUrl),
    getDiagnostic: (runId, name) =>
      fetchJson(
        `/runs/${encodeURIComponent(runId)}/diagnostics/${encodeURIComponent(name)}`,
        undefined,
        baseUrl,
      ),
    listDocsPages: () => fetchJson("/docs/pages", undefined, baseUrl),
    listCapsules: () => fetchJson("/capsules", undefined, baseUrl),
    listTempRuns: () => fetchJson("/temp_runs", undefined, baseUrl),
    getCapsule: (name) =>
      fetchJson(`/capsules/${encodeURIComponent(name)}`, undefined, baseUrl),
    getCapsuleFile: (name, path) =>
      fetchJson(
        `/capsules/${encodeURIComponent(name)}/files/${path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        undefined,
        baseUrl,
      ),
    getCapsuleTree: (name, subtree = "") => {
      const qs = subtree ? `?subtree=${encodeURIComponent(subtree)}` : "";
      return fetchJson(
        `/capsules/${encodeURIComponent(name)}/tree${qs}`,
        undefined,
        baseUrl,
      );
    },
    validateCapsule: (name) =>
      fetchJson(`/capsules/${encodeURIComponent(name)}/validate`, undefined, baseUrl),
    getCapsuleDiagnostics: (name) =>
      fetchJson(
        `/capsules/${encodeURIComponent(name)}/diagnostics`,
        undefined,
        baseUrl,
      ),
    listTools: () => fetchJson("/tools", undefined, baseUrl),
    getTool: (name) => fetchJson(`/tools/${encodeURIComponent(name)}`, undefined, baseUrl),
    getToolDocs: (name) =>
      fetchJson(`/tools/${encodeURIComponent(name)}/docs`, undefined, baseUrl),
    listToolAuthoringTemplates: () =>
      fetchJson("/tool-authoring/templates", undefined, baseUrl),
    listToolAuthoringCodeTemplates: () =>
      fetchJson("/tool-authoring/code-templates", undefined, baseUrl),
    createToolAuthoringCodeTemplate: (body) =>
      fetchJson(
        "/tool-authoring/code-templates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        baseUrl,
      ),
    importToolAuthoringCodeTemplate: (body) =>
      fetchJson(
        "/tool-authoring/code-templates/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        baseUrl,
      ),
    deleteToolAuthoringCodeTemplate: (templateId) =>
      fetchJson(
        `/tool-authoring/code-templates/${encodeURIComponent(templateId)}`,
        { method: "DELETE" },
        baseUrl,
      ),
    createToolDraft: (templateId, name) =>
      fetchJson(
        "/tool-authoring/drafts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_id: templateId, name }),
        },
        baseUrl,
      ),
    listToolDrafts: () => fetchJson("/tool-authoring/drafts", undefined, baseUrl),
    getToolDraft: (draftId) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}`,
        undefined,
        baseUrl,
      ),
    deleteToolDraft: (draftId) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}`,
        { method: "DELETE" },
        baseUrl,
      ),
    readToolDraftFile: (draftId, path) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}/files/${encodePathSegments(path)}`,
        undefined,
        baseUrl,
      ),
    writeToolDraftFile: (draftId, path, content) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}/files/${encodePathSegments(path)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
        baseUrl,
      ),
    applyToolAuthoringCodeTemplate: (draftId, templateId, targetPath) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}/apply-code-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_id: templateId, target_path: targetPath }),
        },
        baseUrl,
      ),
    previewToolDraft: (draftId, harness) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ harness }),
        },
        baseUrl,
      ),
    validateToolDraftManifest: (draftId) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}/manifest`,
        { method: "POST" },
        baseUrl,
      ),
    checkToolDraft: (draftId) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}/check`,
        { method: "POST" },
        baseUrl,
      ),
    registerToolDraft: (draftId) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}/register`,
        { method: "POST" },
        baseUrl,
      ),
    exportToolDraft: (draftId) =>
      fetchJson(
        `/tool-authoring/drafts/${encodeURIComponent(draftId)}/export`,
        { method: "POST" },
        baseUrl,
      ),
    getToolSchema,
    previewTool: async (name, body) => {
      try {
        return await fetchJson(
          `/tools/${encodeURIComponent(name)}/preview`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          baseUrl,
        );
      } catch (error) {
        if (!isMissingEndpoint(error)) throw error;
        const detail = await fetchJson<ToolDetail>(
          `/tools/${encodeURIComponent(name)}`,
          undefined,
          baseUrl,
        );
        return fallbackPreview(schemaFromToolDetail(detail), body);
      }
    },
    runTool: async (name, body) => {
      try {
        const schema = await getToolSchema(name);
        const payload = await fetchJson<unknown>(
          `/tools/${encodeURIComponent(name)}/runs`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          baseUrl,
        );
        return normalizeRunPayload(payload, schema);
      } catch (error) {
        if (!isMissingEndpoint(error)) throw error;
        const detail = await fetchJson<ToolDetail>(
          `/tools/${encodeURIComponent(name)}`,
          undefined,
          baseUrl,
        );
        const legacy = await fetchJson<{ name: string; output: Record<string, unknown> }>(
          `/tools/${encodeURIComponent(name)}/execute`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kwargs: body.inputs, units: body.units ?? {} }),
          },
          baseUrl,
        );
        return normalizeLegacyExecuteResponse(
          legacy.name,
          schemaFromToolDetail(detail),
          legacy.output,
        );
      }
    },
    getToolRun: (name, runId) =>
      Promise.all([
        getToolSchema(name),
        fetchJson<unknown>(
          `/tools/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}`,
          undefined,
          baseUrl,
        ),
      ]).then(([schema, payload]) => normalizeRunPayload(payload, schema)),
    listToolArtifacts: async (name, runId) => {
      try {
        const payload = await fetchJson<unknown>(
          `/tools/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}/artifacts`,
          undefined,
          baseUrl,
        );
        return artifactArrayFromPayload(payload);
      } catch (error) {
        if (isMissingEndpoint(error)) return [];
        throw error;
      }
    },
    getToolArtifact: (artifactId) =>
      fetchJson(
        `/tool-artifacts/${encodeURIComponent(artifactId)}`,
        undefined,
        baseUrl,
      ),
    setToolStatus: (name, status) =>
      // The actor is server-derived. Human-only promotions need a
      // pre-written approval token; the API returns 403 if absent.
      fetchJson(
        `/tools/${encodeURIComponent(name)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
        baseUrl,
      ),
    runToolTests: (name) =>
      fetchJson(
        `/tools/${encodeURIComponent(name)}/run-tests`,
        { method: "POST" },
        baseUrl,
      ),
    executeTool: (name, kwargs, units = {}) =>
      fetchJson(
        `/tools/${encodeURIComponent(name)}/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kwargs, units }),
        },
        baseUrl,
      ),
    exportTool: (name) =>
      fetchJson(
        `/tools/${encodeURIComponent(name)}/export`,
        { method: "POST" },
        baseUrl,
      ),
    importTool: (sourcePath, targetName) =>
      fetchJson(
        "/tools/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_path: sourcePath, target_name: targetName }),
        },
        baseUrl,
      ),
    requestToolPromotion: (name, body) =>
      fetchJson(
        `/tools/${encodeURIComponent(name)}/promote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to_workspace_slug: body.to_workspace_slug,
            justification: body.justification ?? "",
          }),
        },
        baseUrl,
      ),
    listToolPromotions: () =>
      fetchJson("/tool-promotions", undefined, baseUrl),
    approveToolPromotion: (requestId, body) =>
      fetchJson(
        `/tool-promotions/${encodeURIComponent(requestId)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision_note: body.decision_note ?? "" }),
        },
        baseUrl,
      ),
    denyToolPromotion: (requestId, body) =>
      fetchJson(
        `/tool-promotions/${encodeURIComponent(requestId)}/deny`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision_note: body.decision_note ?? "" }),
        },
        baseUrl,
      ),
    importPaper: (capsule, sourcePath) =>
      fetchJson(
        "/papers/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capsule, source_path: sourcePath }),
        },
        baseUrl,
      ),
    getPaperExtracted: (capsule) =>
      fetchJson(
        `/papers/${encodeURIComponent(capsule)}/extracted`,
        undefined,
        baseUrl,
      ),
    editPaperArtifact: (capsule, body) =>
      fetchJson(
        `/papers/${encodeURIComponent(capsule)}/edit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        baseUrl,
      ),
    createProposal: (capsule) =>
      // Backend enforces plan §Phase 4 hard rule (must be human-reviewed)
      // unconditionally. Earlier audit found this was bypassable via a
      // `require_reviewed: false` body field; that knob is gone now.
      fetchJson(
        "/proposals",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ capsule }),
        },
        baseUrl,
      ),
    listCodegen: (capsule) =>
      fetchJson(
        `/capsules/${encodeURIComponent(capsule)}/codegen`,
        undefined,
        baseUrl,
      ),
    runCodegen: (capsule) =>
      // Backend enforces the user_edits/ guard unconditionally — the UI
      // carries no overwrite toggle.
      fetchJson(
        `/capsules/${encodeURIComponent(capsule)}/codegen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        baseUrl,
      ),
    diffCodegen: (capsule) =>
      fetchJson(
        `/capsules/${encodeURIComponent(capsule)}/codegen/diff`,
        undefined,
        baseUrl,
      ),
    runValidation: (capsule) =>
      fetchJson(
        `/capsules/${encodeURIComponent(capsule)}/validate-run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        baseUrl,
      ),
    writeUserEdit: (capsule, path, content) => {
      const safePath = path
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/");
      return fetchJson(
        `/capsules/${encodeURIComponent(capsule)}/user_edits/${safePath}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
        baseUrl,
      );
    },
    getComparisonReport: (capsule) =>
      fetchJson(
        `/comparison/${encodeURIComponent(capsule)}`,
        undefined,
        baseUrl,
      ),
    browse: ({ root, path }, signal) => {
      const search = new URLSearchParams({ root });
      if (path) search.set("path", path);
      return fetchJson(`/browse?${search}`, { signal }, baseUrl);
    },
    listExamples: () =>
      fetchJson(`/examples`, undefined, baseUrl),
    runExample: (name) =>
      fetchJson(
        `/examples/${encodeURIComponent(name)}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        baseUrl,
      ),
    designExperiment: (capsule) =>
      fetchJson(
        `/autonomy/design/${encodeURIComponent(capsule)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        baseUrl,
      ),
    reviewExperiment: (capsule) =>
      fetchJson(
        `/autonomy/review/${encodeURIComponent(capsule)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        baseUrl,
      ),
    smokeExperiment: (capsule) =>
      fetchJson(
        `/autonomy/smoke/${encodeURIComponent(capsule)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        baseUrl,
      ),
    autonomousSweep: (capsule, body) =>
      fetchJson(
        `/autonomy/sweep/${encodeURIComponent(capsule)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        baseUrl,
      ),
  };
}

export const apiClient: ApiClient = createApiClient();

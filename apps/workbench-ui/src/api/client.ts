/**
 * Typed HTTP client for the workbench backend API (Phase 1F).
 *
 * Single source of API types. Components import the request/response shapes
 * from here so that the API contract is enforced at the type level.
 */

export interface RunSummary {
  run_id: string;
  state: string;
  elapsed_seconds: number;
  final_simulation_time: number;
  diagnostics_keys: string[];
  /**
   * True when one or more interactions used a flagged-placeholder rate
   * constant. Phase 1 has no rate-parser, so every run currently has at
   * least one placeholder. The UI must surface this so the user knows the
   * run is exploratory, not validated.
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

const DEFAULT_BASE = "/api";

async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  baseUrl: string = DEFAULT_BASE,
): Promise<T> {
  const r = await fetch(baseUrl + path, init);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`API ${path} failed with ${r.status}: ${text}`);
  }
  return (await r.json()) as T;
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
  setToolStatus(name: string, status: ToolStatus, actor?: string): Promise<{ name: string; status: ToolStatus }>;
  runToolTests(name: string): Promise<{ name: string; passed: boolean; returncode: number; stdout: string; stderr: string }>;
  executeTool(name: string, kwargs: Record<string, unknown>, units?: Record<string, string>): Promise<{ name: string; output: Record<string, unknown> }>;
  exportTool(name: string): Promise<{ name: string; archive: string; size_bytes: number }>;
  importTool(sourcePath: string, targetName: string): Promise<{ name: string; directory: string }>;
  importPaper(capsule: string, sourcePath: string): Promise<PaperImportResult>;
  getPaperExtracted(capsule: string): Promise<PaperExtracted>;
  editPaperArtifact(capsule: string, body: PaperEditPayload): Promise<{ capsule: string; ok: boolean }>;
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

export function createApiClient(baseUrl: string = DEFAULT_BASE): ApiClient {
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
    setToolStatus: (name, status, actor = "human") =>
      fetchJson(
        `/tools/${encodeURIComponent(name)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, actor }),
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
  };
}

export const apiClient: ApiClient = createApiClient();

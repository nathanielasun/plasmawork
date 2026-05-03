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
  validateCapsule(name: string): Promise<CapsuleValidation>;
  getCapsuleDiagnostics(name: string): Promise<CapsuleDiagnostics>;
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
    validateCapsule: (name) =>
      fetchJson(`/capsules/${encodeURIComponent(name)}/validate`, undefined, baseUrl),
    getCapsuleDiagnostics: (name) =>
      fetchJson(
        `/capsules/${encodeURIComponent(name)}/diagnostics`,
        undefined,
        baseUrl,
      ),
  };
}

export const apiClient: ApiClient = createApiClient();

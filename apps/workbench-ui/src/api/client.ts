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
  placeholder_used?: boolean;
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
  };
}

export const apiClient: ApiClient = createApiClient();

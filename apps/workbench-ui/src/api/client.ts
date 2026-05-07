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

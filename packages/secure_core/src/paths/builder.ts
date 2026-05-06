/**
 * Workspace path builder — Phase 0.5 Layer-2 (L2.10).
 *
 * Single producer of every workspace artifact path, per v4 §9.3. Every
 * route handler, background worker, or registry mutation that writes
 * to a workspace storage path goes through this builder; nothing else
 * is permitted to concatenate strings into `<storage_root>/workspaces/`.
 *
 * Caller contract:
 *   Routes have already passed through `requireWorkspaceMembership`
 *   before they reach this builder; we trust the workspaceId at that
 *   point. Non-HTTP callers (background workers, CLIs, scheduled
 *   jobs) MUST verify membership before invoking the builder. The
 *   builder itself does NOT consult the membership cache — that's
 *   `requireWorkspaceMembership`'s job, and re-doing it here would
 *   double the per-request DB load.
 *
 * Failure surface:
 *   `PathInvalidError` with code `PATH_INVALID` for every refusal.
 *   Each refusal also emits a single `path_access.denied` audit row
 *   carrying `{ rejected_field: "<field>", denied_reason: <reason> }`.
 *   The user-facing message is generic; the audit row carries the
 *   discriminating reason and the workspace id (server-derived).
 *
 * Validation order (each step rejects before the next runs):
 *   1. workspaceId matches the v4 UUID regex (§9.2).
 *   2. subpath is one of `WORKSPACE_SUBPATHS`.
 *   3. relativePath (if provided + non-empty) passes
 *      `classifyRelativePath` from `./components.ts`.
 *   4. `safeOpenPath({ mode: "verify" })` confirms the resolved
 *      canonical path is contained in the subpath root via component-
 *      array equality (§9.4.1–§9.4.2).
 */

import * as path from "node:path";

import type { AuditLogger } from "../audit/logger.js";
import { PathInvalidError } from "../errors/shapes.js";
import { repoRoot } from "../secrets/repoRoot.js";
import { classifyRelativePath } from "./components.js";
import { safeOpenPath } from "./safeOpen.js";

/** v4 §9.1 — frozen, exact, ordered as in the plan. */
export const WORKSPACE_SUBPATHS = [
  "simulation_capsules",
  "temp_runs",
  "local_cache",
  "temp_imports",
  "generated_code",
  "imported_tools",
  "exported_reports",
  "audit_exports",
] as const;

export type WorkspaceSubpath = (typeof WORKSPACE_SUBPATHS)[number];

const WORKSPACE_SUBPATH_SET: ReadonlySet<string> = new Set(WORKSPACE_SUBPATHS);

export function isWorkspaceSubpath(value: unknown): value is WorkspaceSubpath {
  return typeof value === "string" && WORKSPACE_SUBPATH_SET.has(value);
}

/** v4 §9.2 — workspace IDs are UUID v4. Same regex as `loadWorkspace.ts`. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface WorkspacePathOptions {
  /** UUID v4 — already validated upstream by `loadWorkspace`. */
  readonly workspaceId: string;
  readonly subpath: WorkspaceSubpath;
  /** Optional sub-tree relative to the subpath root, `/`-separated. */
  readonly relativePath?: string;
}

export interface WorkspacePathBuilderOptions {
  /**
   * Override the on-disk storage root for workspaces. In production
   * this is wired to a secrets-resolved value at boot; the constructor
   * takes the resolved string so this module never reads `process.env`
   * directly. This is the parent that contains the `workspaces/`
   * namespace. In dev / tests, leave this undefined and the builder
   * falls back to `<repoRoot>/local_cache`, producing
   * `<repoRoot>/local_cache/workspaces/<workspaceId>/...`.
   */
  readonly workspaceStorageRoot?: string;
  /**
   * Optional audit logger. When provided, every refusal path emits
   * exactly one `path_access.denied` row. When omitted (e.g. in a
   * CLI tool) refusals still throw `PathInvalidError` but no audit
   * row is written — callers running outside Layer-3 are responsible
   * for their own audit pipeline.
   */
  readonly auditLogger?: AuditLogger;
}

/**
 * Reasons we surface in `metadata.denied_reason`. The closed union
 * subsumes `ComponentRejection` from `./components.ts` plus the two
 * traversal reasons surfaced by `safeOpenPath`.
 */
type DeniedReason =
  | "nul_byte"
  | "percent_encoded_separator"
  | "empty"
  | "dot_or_dotdot"
  | "leading_dot"
  | "trailing_dot_or_space"
  | "regex_mismatch"
  | "symlink_or_non_directory"
  | "outside_root"
  | "invalid_workspace_id"
  | "invalid_subpath";

export class WorkspacePathBuilder {
  private readonly storageRoot: string;
  private readonly auditLogger: AuditLogger | undefined;

  public constructor(opts: WorkspacePathBuilderOptions) {
    this.storageRoot =
      opts.workspaceStorageRoot ?? path.join(repoRoot(), "local_cache");
    if (!path.isAbsolute(this.storageRoot)) {
      throw new Error(
        `WorkspacePathBuilder: workspaceStorageRoot must be absolute, got "${this.storageRoot}"`,
      );
    }
    this.auditLogger = opts.auditLogger;
  }

  /** `<storageRoot>/workspaces/<workspaceId>` — unvalidated form. */
  public workspaceRoot(workspaceId: string): string {
    this.assertWorkspaceId(workspaceId, "workspace_id");
    return path.join(this.storageRoot, "workspaces", workspaceId);
  }

  /** `<storageRoot>/workspaces/<workspaceId>/<subpath>`. */
  public workspaceSubpathRoot(
    workspaceId: string,
    subpath: WorkspaceSubpath,
  ): string {
    this.assertWorkspaceId(workspaceId, "workspace_id");
    this.assertSubpath(subpath);
    return path.join(this.workspaceRoot(workspaceId), subpath);
  }

  /**
   * Build a workspace artifact path. Returns the absolute canonical
   * path (with the leaf normalized via realpath of the deepest
   * existing prefix) ready to hand to a downstream `safeOpenPath`
   * call in `read` / `write` mode.
   */
  public async build(opts: WorkspacePathOptions): Promise<string> {
    this.assertWorkspaceId(opts.workspaceId, "workspace_id");
    this.assertSubpath(opts.subpath);

    const subpathRoot = this.workspaceSubpathRoot(
      opts.workspaceId,
      opts.subpath,
    );

    const rel = opts.relativePath;
    if (rel === undefined || rel.length === 0) {
      // No leaf — the caller wants the subpath root itself. Verify
      // containment of the root against itself; this also catches a
      // mid-path symlink in the storage root chain.
      const result = await this.runVerify(opts.workspaceId, subpathRoot, "");
      return result;
    }

    const rejection = classifyRelativePath(rel);
    if (rejection !== null) {
      await this.emitDenied(opts.workspaceId, "relative_path", rejection.reason);
      throw new PathInvalidError("Path component invalid.", {
        reason: rejection.reason,
      });
    }

    return this.runVerify(opts.workspaceId, subpathRoot, rel);
  }

  // --- private helpers --------------------------------------------------

  private async runVerify(
    workspaceId: string,
    subpathRoot: string,
    relativePath: string,
  ): Promise<string> {
    try {
      const result = await safeOpenPath({
        root: subpathRoot,
        relativePath,
        mode: "verify",
      });
      return result.canonicalPath;
    } catch (err) {
      if (err instanceof PathInvalidError) {
        const reason = this.extractReason(err);
        await this.emitDenied(workspaceId, "relative_path", reason);
      }
      throw err;
    }
  }

  private extractReason(err: PathInvalidError): DeniedReason {
    const details = err.details;
    if (details && typeof details["reason"] === "string") {
      const r = details["reason"] as string;
      // Defense-in-depth: validate against the closed enum so a
      // mistyped reason can't sneak into metadata.
      if (
        r === "symlink_or_non_directory" ||
        r === "outside_root" ||
        r === "nul_byte" ||
        r === "percent_encoded_separator" ||
        r === "empty" ||
        r === "dot_or_dotdot" ||
        r === "leading_dot" ||
        r === "trailing_dot_or_space" ||
        r === "regex_mismatch"
      ) {
        return r;
      }
    }
    return "outside_root";
  }

  private assertWorkspaceId(value: string, field: string): void {
    if (typeof value !== "string" || !UUID_V4_RE.test(value)) {
      // We can't emit an audit row with a non-UUID workspaceId because
      // the audit pipeline would carry a malformed identifier; emit
      // with workspaceId = null and the rejected_field set to the
      // workspace_id slot.
      void this.emitDenied(null, field, "invalid_workspace_id");
      throw new PathInvalidError("Path component invalid.", {
        reason: "invalid_workspace_id",
      });
    }
  }

  private assertSubpath(value: string): void {
    if (!isWorkspaceSubpath(value)) {
      void this.emitDenied(null, "subpath", "invalid_subpath");
      throw new PathInvalidError("Path component invalid.", {
        reason: "invalid_subpath",
      });
    }
  }

  private async emitDenied(
    workspaceId: string | null,
    rejectedField: string,
    deniedReason: DeniedReason,
  ): Promise<void> {
    const logger = this.auditLogger;
    if (!logger) return;
    // Match validateInputSchema.ts:160-166 — emit as `unauthenticated`
    // until L2-batch-2 wires `req.audit` into the builder. The route
    // layer can override later by passing actorType / actorUserId in
    // a follow-up `WorkspacePathBuilder` opt; the audit row's
    // `request_id` will become non-null at that time too.
    try {
      await logger.write({
        workspaceId: workspaceId !== null && UUID_V4_RE.test(workspaceId)
          ? workspaceId
          : null,
        actorUserId: null,
        actorType: "unauthenticated",
        action: "path_access.denied",
        result: "denied",
        // The audit logger requires a non-empty requestId. Until the
        // builder is wired into `req.audit`, we synthesize a per-call
        // marker so the row is identifiable as builder-originated.
        requestId: `builder-${Date.now()}`,
        metadata: {
          rejected_field: rejectedField,
          denied_reason: deniedReason,
        },
      });
    } catch {
      // Audit emission is best-effort at this layer; the throw in the
      // caller is what enforces the security boundary. A follow-up
      // task wires a writer-failure surface to the operator console.
    }
  }
}

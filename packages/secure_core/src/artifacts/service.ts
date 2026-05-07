/**
 * Artifact service — Phase 0.5 Layer 4 task L4.5.
 *
 * Backs the v4 §10.2 artifact endpoints:
 *
 *   GET  /workspaces/:workspaceId/artifacts                           listArtifacts
 *   GET  /workspaces/:workspaceId/artifacts/:artifactId               getArtifactOrThrow
 *   POST /workspaces/:workspaceId/artifacts/:artifactId/export        requestExport
 *
 * v4 §17 — `artifact_export` is a high-risk action. The export route
 * is gated by L2.9 `requireApprovalIfHighRisk` (X-Approval-Token
 * header). This service is responsible for:
 *
 *   1. SSRF validation of the caller-supplied `destination_uri` —
 *      delegated to `SsrfGuard.validateUrl` (L3.10). Loopback /
 *      private / metadata destinations are refused before any bytes
 *      leave the host. The guard is injected via the constructor so
 *      tests can substitute a deterministic resolver.
 *   2. Reserving `expected_size_bytes` against the workspace's
 *      `stored.bytes` quota via `StorageReservationService.reserveBytes`
 *      (L3.5). The reservation FK points at `users.id` (`requestedBy`)
 *      — the actor's user id, NOT the artifact id. Quota exhaustion
 *      surfaces as `QuotaExceededError` (-> 429); SSRF refusal as
 *      `InputInvalidError` (-> 400). Both propagate to the route.
 *   3. Emitting `artifact.exported` audit BEFORE returning. Per L1.7
 *      the metadata is constrained to the redaction allowlist; we
 *      pass `bytes_reserved` (stringified bigint) only — destination
 *      URI / reservation id / export id are never written into the
 *      audit metadata.
 *
 * The actual upload to `destination_uri` is a worker job; this
 * endpoint creates the manifest only and returns
 * `{ exportId, reservationId, expiresAt }`. The worker commits the
 * reservation on success and releases it on failure.
 *
 * Hard rules:
 *   - The service NEVER reads `actor*` / `created_by` / `requested_by`
 *     from anywhere except the caller's `actorUserId` argument.
 *   - The list / read paths SELECT only the columns named in
 *     `ArtifactRow` — chain-internal columns from other tables never
 *     leak through.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, or } from "drizzle-orm";

import type { SecureCorePool } from "../db/pool.js";
import type { AuditLogger } from "../audit/logger.js";
import { artifactFiles } from "../db/schema.js";
import { NotFoundError } from "../errors/shapes.js";
import type { SsrfGuard } from "../outbound/ssrf.js";
import type { StorageReservationService } from "../quotas/storageReservations.js";

/**
 * Default keyset page size for list. Matches L4.7 conventions —
 * callers may request `1..MAX_LIMIT`; out-of-range values raise at the
 * route boundary, not silently clamp here.
 */
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

/**
 * Public row shape returned by list / read. Mirrors the DB columns the
 * caller actually consumes — no chain-internal columns or HMAC'd
 * server-only fields are exposed.
 */
export interface ArtifactRow {
  id: string;
  workspace_id: string;
  artifact_type: string;
  storage_path: string;
  content_hash: string | null;
  created_by: string;
  created_at: Date;
}

/**
 * Keyset cursor for `listArtifacts`. The wire-format encode/decode
 * lives in the route plugin so the service is independent of HTTP
 * transport.
 */
export interface ArtifactKeysetCursor {
  createdAt: Date;
  id: string;
}

export interface ListArtifactsOptions {
  limit?: number;
  cursor?: ArtifactKeysetCursor;
}

export interface ListArtifactsResult {
  rows: ArtifactRow[];
  nextCursor: ArtifactKeysetCursor | null;
}

export interface RequestExportOptions {
  workspaceId: string;
  artifactId: string;
  destinationUri: string;
  expectedSizeBytes: bigint;
  actorUserId: string;
  requestId: string;
}

export interface RequestExportResult {
  exportId: string;
  reservationId: string;
  expiresAt: Date;
}

export interface ArtifactServiceOptions {
  readonly pool: SecureCorePool;
  readonly auditLogger: AuditLogger;
  readonly ssrfGuard: SsrfGuard;
  readonly storageReservations: StorageReservationService;
}

/**
 * Service-wrapper for artifact list / read / export-request.
 */
export class ArtifactService {
  private readonly pool: SecureCorePool;
  private readonly auditLogger: AuditLogger;
  private readonly ssrfGuard: SsrfGuard;
  private readonly storageReservations: StorageReservationService;

  public constructor(opts: ArtifactServiceOptions) {
    this.pool = opts.pool;
    this.auditLogger = opts.auditLogger;
    this.ssrfGuard = opts.ssrfGuard;
    this.storageReservations = opts.storageReservations;
  }

  /**
   * Keyset-paginated list of artifacts in `workspaceId`. Ordering is
   * stable on `(created_at ASC, id ASC)` so the cursor is monotonic.
   */
  public async listArtifacts(
    workspaceId: string,
    opts: ListArtifactsOptions = {},
  ): Promise<ListArtifactsResult> {
    const limit = Math.min(
      Math.max(opts.limit ?? DEFAULT_LIST_LIMIT, 1),
      MAX_LIST_LIMIT,
    );
    // Fetch one extra row to compute `nextCursor` without a count query.
    const fetchLimit = limit + 1;

    const cursorPredicate =
      opts.cursor !== undefined
        ? or(
            gt(artifactFiles.createdAt, opts.cursor.createdAt),
            and(
              eq(artifactFiles.createdAt, opts.cursor.createdAt),
              gt(artifactFiles.id, opts.cursor.id),
            ),
          )
        : undefined;

    const rows = await this.pool.db
      .select({
        id: artifactFiles.id,
        workspace_id: artifactFiles.workspaceId,
        artifact_type: artifactFiles.artifactType,
        storage_path: artifactFiles.storagePath,
        content_hash: artifactFiles.contentHash,
        created_by: artifactFiles.createdBy,
        created_at: artifactFiles.createdAt,
      })
      .from(artifactFiles)
      .where(
        cursorPredicate !== undefined
          ? and(eq(artifactFiles.workspaceId, workspaceId), cursorPredicate)
          : eq(artifactFiles.workspaceId, workspaceId),
      )
      .orderBy(asc(artifactFiles.createdAt), asc(artifactFiles.id))
      .limit(fetchLimit);

    let nextCursor: ArtifactKeysetCursor | null = null;
    let pageRows: ArtifactRow[] = rows;
    if (rows.length > limit) {
      pageRows = rows.slice(0, limit);
      const last = pageRows[pageRows.length - 1];
      nextCursor = { createdAt: last.created_at, id: last.id };
    }
    return { rows: pageRows, nextCursor };
  }

  /**
   * Read a single artifact's metadata. Workspace-scoping is normally
   * enforced by `enforceObjectWorkspaceScope` in the L2 chain BEFORE
   * the handler runs; we still re-check here so a service-level caller
   * (worker, internal job) cannot read across workspaces. Non-matching
   * workspace collapses to the same uniform NotFoundError per v4 §4.4.
   */
  public async getArtifactOrThrow(
    workspaceId: string,
    artifactId: string,
  ): Promise<ArtifactRow> {
    const rows = await this.pool.db
      .select({
        id: artifactFiles.id,
        workspace_id: artifactFiles.workspaceId,
        artifact_type: artifactFiles.artifactType,
        storage_path: artifactFiles.storagePath,
        content_hash: artifactFiles.contentHash,
        created_by: artifactFiles.createdBy,
        created_at: artifactFiles.createdAt,
      })
      .from(artifactFiles)
      .where(
        and(
          eq(artifactFiles.id, artifactId),
          eq(artifactFiles.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new NotFoundError("Not found.");
    }
    return row;
  }

  /**
   * Validate the destination URL via `SsrfGuard.validateUrl` (refuses
   * loopback / private / metadata destinations), reserve
   * `expected_size_bytes` against the workspace's `stored.bytes`
   * quota via `StorageReservationService.reserveBytes`, and emit
   * `artifact.exported` BEFORE returning.
   *
   * The artifact must exist + be in this workspace; failure collapses
   * to NotFoundError per v4 §4.4.
   *
   * Order is intentional:
   *   SSRF validate → quota reserve → audit emit → return.
   *
   * If SSRF refuses, no reservation is created and no audit row is
   * written for the export attempt — the SSRF refusal is itself
   * audited inside the SsrfGuard's surrounding L3.10 path. If quota
   * refuses, the counter service writes the `quota.exceeded` row and
   * raises `QuotaExceededError`.
   */
  public async requestExport(
    opts: RequestExportOptions,
  ): Promise<RequestExportResult> {
    // 1. Existence + workspace-scope check at the service boundary.
    //    The L2 chain's enforceObjectWorkspaceScope has already run for
    //    the route caller; this re-check defends against a service-
    //    level bypass.
    await this.getArtifactOrThrow(opts.workspaceId, opts.artifactId);

    // 2. SSRF validation — refuses loopback / private / metadata IPs.
    //    `validateUrl` raises InputInvalidError on rejection.
    await this.ssrfGuard.validateUrl(opts.destinationUri);

    // 3. Reserve quota. `reserveBytes` raises QuotaExceededError on
    //    insufficient quota.
    const reservation = await this.storageReservations.reserveBytes({
      workspaceId: opts.workspaceId,
      requestedBy: opts.actorUserId,
      bytes: opts.expectedSizeBytes,
      requestId: opts.requestId,
    });

    // 4. Generate the export id (manifest id). The actual upload is a
    //    worker job that consults this id; the worker commits or
    //    releases the reservation on terminal status.
    const exportId = randomUUID();

    // 5. Emit `artifact.exported` audit. Metadata is constrained to
    //    L1.7's allowlist — only `bytes_reserved` (stringified bigint)
    //    is included. Destination URI, export id, and reservation id
    //    are NEVER written into audit metadata.
    await this.auditLogger.write({
      workspaceId: opts.workspaceId,
      actorUserId: opts.actorUserId,
      actorType: "human",
      action: "artifact.exported",
      objectType: "artifact",
      objectId: opts.artifactId,
      result: "succeeded",
      requestId: opts.requestId,
      metadata: {
        bytes_reserved: opts.expectedSizeBytes.toString(),
      },
    });

    return {
      exportId,
      reservationId: reservation.reservationId,
      expiresAt: reservation.expiresAt,
    };
  }
}


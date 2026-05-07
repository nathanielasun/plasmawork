/**
 * Audit / provenance / operator chain verifier — Phase 0.5 Layer-3 (L3.1).
 *
 * Walks one of the three hash-chained log tables in chronological order
 * and recomputes every row's `row_hash` from the canonical field set
 * specified in v4 §19.3. A row whose stored `row_hash` does not match
 * the recomputation is reported as `firstFailureRowId` with reason
 * `hash_mismatch`. A row whose stored `prev_hash` does not match the
 * previous row's `row_hash` is reported as `missing_prev_hash`.
 *
 * Tail truncation (§19.3, last paragraph): if `log_chain_anchors`
 * carries a row pointing at `anchored_row_id = X` for this `log_type`
 * but the local DB no longer contains row X, or contains it with a
 * different `row_hash`, the verifier reports `tail_truncation`. The
 * anchor table is *append-only* and pinned to external WORM by L3.2
 * (the anchor committer); this module only consumes anchors.
 *
 * Cross-task: L3.2 writes anchors. The contract this verifier expects:
 *   - Each anchor row carries `log_type`, `anchored_row_id`, and
 *     `anchor_hash` (the `row_hash` of `anchored_row_id` at the moment
 *     of commit).
 *   - The latest anchor for a given `log_type` (by `committed_at`) is
 *     the trust point. Older anchors are still valid history but a
 *     newer one supersedes them for verification purposes.
 *
 * Source: v4 §19.3 (Hash Chain and External Anchor), §19.5 (Required
 * Audit Events), `src/audit/logger.ts` (chain math).
 */

import { createHash } from "node:crypto";

import { canonicalize, CANONICALIZATION_VERSION } from "../crypto/jcs.js";
import type { SecureCorePool } from "../db/pool.js";
import type { AuditLogType } from "./dbWriter.js";
import type { S3AnchorProvider } from "./s3Provider.js";

export type VerifyFailureReason =
  | "hash_mismatch"
  | "missing_prev_hash"
  | "tail_truncation"
  | "external_anchor_mismatch";

export type VerifyReport =
  | { ok: true; rowsVerified: number; tipHash: string | null }
  | {
      ok: false;
      rowsVerified: number;
      firstFailureRowId: string;
      failureReason: VerifyFailureReason;
    };

export interface AuditChainVerifierOptions {
  pool: SecureCorePool;
  logType: AuditLogType;
  /**
   * Optional external WORM reader. Unit tests and production verifier
   * jobs pass this so §29 #50 compares the DB anchor row against the
   * immutable object. Request-path callers may omit it and still get
   * local-chain + local-anchor verification.
   */
  anchorProvider?: S3AnchorProvider;
}

/**
 * Map an `AuditLogType` to:
 *   - the SQL table name carrying the rows, and
 *   - the `log_chain_anchors.log_type` literal that anchors target this
 *     table (note: anchors store the table name verbatim).
 *
 * This keeps the two strings in lockstep with the schema and the v4
 * §12 CHECK constraint on `log_chain_anchors.log_type`.
 */
function resolveTable(logType: AuditLogType): {
  tableName: string;
  anchorLogType: string;
} {
  switch (logType) {
    case "audit":
      return { tableName: "audit_events", anchorLogType: "audit_events" };
    case "provenance":
      return {
        tableName: "provenance_events",
        anchorLogType: "provenance_events",
      };
    case "operator":
      return {
        tableName: "operator_events",
        anchorLogType: "operator_events",
      };
  }
}

/**
 * Common shape every row reaches after the per-table SELECT. Per v4
 * §19.3, `created_at` is RFC 3339 UTC; we re-stringify the JS `Date`
 * postgres-js returns into the canonical millisecond-precision form
 * `Date.toISOString()` emits. The other fields are scalars.
 *
 * `canonicalFields` is the field set §19.3 specifies for the table,
 * already in the snake_case shape `canonicalize` will hash.
 */
interface FetchedRow {
  id: string;
  prev_hash: string | null;
  row_hash: string;
  canonicalization_version: string;
  canonicalFields: Record<string, unknown>;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  // postgres-js can return strings if a custom parser is set; fall
  // through to constructing a Date so we always emit canonical form.
  return new Date(value).toISOString();
}

function isoStrict(value: Date | string): string {
  const out = isoOrNull(value);
  if (out === null) {
    throw new Error(
      "audit verifier: required timestamp column is null; this is a schema invariant violation",
    );
  }
  return out;
}

/**
 * Recompute one row's `row_hash` from its canonical fields and the
 * given `prevHash`. Mirrors `computeAuditRowHash` in `audit/logger.ts`
 * but is duplicated here (rather than imported) because the logger's
 * helper is typed against `audit_events`-shaped fields and the verifier
 * walks three tables. The math is identical:
 *
 *     row_hash = sha256(JCS({ prev_hash, ...canonical_fields,
 *                             canonicalization_version }))
 */
function recomputeRowHash(args: {
  prevHash: string | null;
  canonicalFields: Record<string, unknown>;
}): string {
  const payload = {
    prev_hash: args.prevHash,
    ...args.canonicalFields,
    canonicalization_version: CANONICALIZATION_VERSION,
  };
  return createHash("sha256")
    .update(canonicalize(payload), "utf8")
    .digest("hex");
}

/**
 * Walk a list of fetched rows top-to-bottom, comparing each row's
 * stored `row_hash` to the recomputation and each row's stored
 * `prev_hash` to the previous row's `row_hash`. Returns either an
 * `ok: true` report with the number of rows verified and the chain
 * tip's hash, or an `ok: false` report identifying the first row that
 * broke the invariant.
 *
 * `expectedFirstPrevHash` lets the caller anchor the walk: when
 * verifying the entire chain, pass `null` (the chain's first row has
 * `prev_hash = null`); when verifying a segment from an anchor, pass
 * the anchor's `anchor_hash` so the walk starts where the anchor
 * stopped.
 */
function walkRows(
  rows: readonly FetchedRow[],
  expectedFirstPrevHash: string | null,
): VerifyReport {
  let expectedPrev: string | null = expectedFirstPrevHash;
  let verified = 0;
  let tip: string | null = null;
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return {
        ok: false,
        rowsVerified: verified,
        firstFailureRowId: row.id,
        failureReason: "missing_prev_hash",
      };
    }
    const recomputed = recomputeRowHash({
      prevHash: row.prev_hash,
      canonicalFields: row.canonicalFields,
    });
    if (recomputed !== row.row_hash) {
      return {
        ok: false,
        rowsVerified: verified,
        firstFailureRowId: row.id,
        failureReason: "hash_mismatch",
      };
    }
    verified += 1;
    expectedPrev = row.row_hash;
    tip = row.row_hash;
  }
  return { ok: true, rowsVerified: verified, tipHash: tip };
}

/**
 * Reads anchored history for the given `log_type` and returns the
 * latest anchor (highest `committed_at`) or `null` if no anchor has
 * been committed yet. The anchor's `anchored_row_id` MUST exist in the
 * local table with a matching `row_hash`; if not, the chain has been
 * truncated after a committed anchor (§19.3).
 */
async function readLatestAnchor(
  pool: SecureCorePool,
  anchorLogType: string,
): Promise<{
  anchored_row_id: string;
  anchor_hash: string;
  external_anchor_uri: string;
} | null> {
  const rows = await pool.sql<
    {
      anchored_row_id: string;
      anchor_hash: string;
      external_anchor_uri: string;
    }[]
  >`
    SELECT anchored_row_id, anchor_hash, external_anchor_uri
    FROM log_chain_anchors
    WHERE log_type = ${anchorLogType}
    ORDER BY committed_at DESC, id DESC
    LIMIT 1
  `;
  if (rows.length === 0) {
    return null;
  }
  return rows[0];
}

async function readAnchorForRow(
  pool: SecureCorePool,
  anchorLogType: string,
  anchoredRowId: string,
  anchorHash: string,
): Promise<{
  anchored_row_id: string;
  anchor_hash: string;
  external_anchor_uri: string;
} | null> {
  const rows = await pool.sql<
    {
      anchored_row_id: string;
      anchor_hash: string;
      external_anchor_uri: string;
    }[]
  >`
    SELECT anchored_row_id, anchor_hash, external_anchor_uri
    FROM log_chain_anchors
    WHERE log_type = ${anchorLogType}
      AND anchored_row_id = ${anchoredRowId}::uuid
      AND anchor_hash = ${anchorHash}
    ORDER BY committed_at DESC, id DESC
    LIMIT 1
  `;
  if (rows.length === 0) {
    return null;
  }
  return rows[0];
}

/**
 * Walk the full chain in chronological order and verify every row.
 * Also consults `log_chain_anchors` for the latest anchor of this
 * `log_type` and reports `tail_truncation` if the anchored row is
 * missing or mismatched in the local DB.
 */
export class AuditChainVerifier {
  private readonly pool: SecureCorePool;
  private readonly logType: AuditLogType;
  private readonly tableName: string;
  private readonly anchorLogType: string;
  private readonly anchorProvider: S3AnchorProvider | undefined;

  public constructor(opts: AuditChainVerifierOptions) {
    this.pool = opts.pool;
    const resolved = resolveTable(opts.logType);
    this.logType = opts.logType;
    this.tableName = resolved.tableName;
    this.anchorLogType = resolved.anchorLogType;
    this.anchorProvider = opts.anchorProvider;
  }

  /**
   * Verify every row in the table. Returns `ok: true` only when every
   * row's `row_hash` recomputes correctly, every `prev_hash` matches
   * the previous tip, AND the latest anchor (if any) points at a row
   * that exists locally with a matching hash.
   */
  public async verifyAll(): Promise<VerifyReport> {
    const fetched = await this.fetchAll();

    // Tail-truncation check first: if an anchor exists but its
    // anchored row is missing or hash-mismatched in the local DB,
    // the chain has been truncated after the anchor was committed.
    const anchor = await readLatestAnchor(this.pool, this.anchorLogType);
    if (anchor !== null) {
      if (this.anchorProvider !== undefined) {
        const externalMatches = await this.externalAnchorMatches(anchor);
        if (!externalMatches) {
          return {
            ok: false,
            rowsVerified: 0,
            firstFailureRowId: anchor.anchored_row_id,
            failureReason: "external_anchor_mismatch",
          };
        }
      }
      const localRow = fetched.find((r) => r.id === anchor.anchored_row_id);
      if (
        localRow === undefined ||
        localRow.row_hash !== anchor.anchor_hash
      ) {
        return {
          ok: false,
          rowsVerified: 0,
          firstFailureRowId: anchor.anchored_row_id,
          failureReason: "tail_truncation",
        };
      }
    }

    return walkRows(fetched, null);
  }

  private async externalAnchorMatches(anchor: {
    anchored_row_id: string;
    anchor_hash: string;
    external_anchor_uri: string;
  }): Promise<boolean> {
    if (this.anchorProvider === undefined) {
      return true;
    }
    try {
      const raw = await this.anchorProvider.getObjectByUri(
        anchor.external_anchor_uri,
      );
      const parsed = JSON.parse(raw.toString("utf8")) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return false;
      }
      const body = parsed as Record<string, unknown>;
      return (
        body.log_type === this.anchorLogType &&
        body.tip_row_id === anchor.anchored_row_id &&
        body.tip_row_hash === anchor.anchor_hash
      );
    } catch {
      return false;
    }
  }

  /**
   * Verify a chain segment starting at `anchorRowId`. The segment
   * starts WITH the anchored row (its stored `prev_hash` is checked
   * against `null`-equivalent: every row in §19.3 chains back to the
   * previous tip, but the verifier only revalidates the segment from
   * the anchor's row forward). This is intended for periodic
   * verification after an anchor commits — Layer-3 uses this path to
   * verify only the most recent segment without re-walking history.
   *
   * The anchored row MUST exist locally with `row_hash === anchorRowHash`;
   * otherwise the segment cannot start and we report `tail_truncation`.
   */
  public async verifyFromAnchor(
    anchorRowId: string,
    anchorRowHash: string,
  ): Promise<VerifyReport> {
    if (this.anchorProvider !== undefined) {
      const externalAnchor = await readAnchorForRow(
        this.pool,
        this.anchorLogType,
        anchorRowId,
        anchorRowHash,
      );
      if (
        externalAnchor === null ||
        !(await this.externalAnchorMatches(externalAnchor))
      ) {
        return {
          ok: false,
          rowsVerified: 0,
          firstFailureRowId: anchorRowId,
          failureReason: "external_anchor_mismatch",
        };
      }
    }
    const anchored = await this.fetchAnchorRow(anchorRowId);
    if (anchored === null || anchored.row_hash !== anchorRowHash) {
      return {
        ok: false,
        rowsVerified: 0,
        firstFailureRowId: anchorRowId,
        failureReason: "tail_truncation",
      };
    }
    const segment = await this.fetchFrom(anchorRowId);
    // Segment starts with the anchored row itself; its stored
    // prev_hash chains back to whatever preceded it in the full
    // history, which we accept as-given. Verify hash-validity of the
    // anchored row independently, then the rest of the chain.
    const recomputed = recomputeRowHash({
      prevHash: anchored.prev_hash,
      canonicalFields: anchored.canonicalFields,
    });
    if (recomputed !== anchored.row_hash) {
      return {
        ok: false,
        rowsVerified: 0,
        firstFailureRowId: anchored.id,
        failureReason: "hash_mismatch",
      };
    }
    // Continue with rows AFTER the anchor; their prev_hash should
    // chain to the anchor's row_hash.
    return this.continueWalk(segment, anchored.row_hash, 1);
  }

  /** Walk a segment starting after the seed; helper for verifyFromAnchor. */
  private continueWalk(
    rows: readonly FetchedRow[],
    expectedFirstPrev: string,
    seedCount: number,
  ): VerifyReport {
    const inner = walkRows(rows, expectedFirstPrev);
    if (inner.ok) {
      return {
        ok: true,
        rowsVerified: inner.rowsVerified + seedCount,
        tipHash: inner.tipHash ?? expectedFirstPrev,
      };
    }
    return {
      ...inner,
      rowsVerified: inner.rowsVerified + seedCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Per-table fetch dispatch — each logType has its own canonical field set
  // per v4 §19.3.
  // ---------------------------------------------------------------------------

  private async fetchAll(): Promise<readonly FetchedRow[]> {
    switch (this.logType) {
      case "audit":
        return this.fetchAllAudit();
      case "provenance":
        return this.fetchAllProvenance();
      case "operator":
        return this.fetchAllOperator();
    }
  }

  private async fetchFrom(
    anchorRowId: string,
  ): Promise<readonly FetchedRow[]> {
    // Rows whose (timestamp, id) is strictly greater than the anchored
    // row's. The chronological column differs by log type per v4 §12:
    // audit_events / provenance_events use `created_at`;
    // operator_events uses `started_at`.
    const tsColumn = this.logType === "operator" ? "started_at" : "created_at";
    const boundary = await this.pool.sql.unsafe<
      Array<{ ts: Date; id: string }>
    >(
      `SELECT ${tsColumn} AS ts, id FROM ${this.tableName} WHERE id = $1`,
      [anchorRowId],
    );
    if (boundary.length === 0) {
      return [];
    }
    const { ts, id } = boundary[0];
    switch (this.logType) {
      case "audit":
        return this.fetchAllAudit({ afterCreatedAt: ts, afterId: id });
      case "provenance":
        return this.fetchAllProvenance({
          afterCreatedAt: ts,
          afterId: id,
        });
      case "operator":
        return this.fetchAllOperator({
          afterCreatedAt: ts,
          afterId: id,
        });
    }
  }

  private async fetchAnchorRow(anchorRowId: string): Promise<FetchedRow | null> {
    const all = await this.fetchAll();
    return all.find((r) => r.id === anchorRowId) ?? null;
  }

  private async fetchAllAudit(
    after?: { afterCreatedAt: Date; afterId: string },
  ): Promise<readonly FetchedRow[]> {
    const where = after
      ? `WHERE (created_at, id) > ($1::timestamptz, $2::uuid)`
      : "";
    const params = after ? [after.afterCreatedAt, after.afterId] : [];
    const sql =
      `SELECT id, workspace_id, actor_user_id, actor_type, action, ` +
      `       object_type, object_id, result, request_id, ` +
      `       ip_hmac, user_agent_hmac, metadata, created_at, ` +
      `       prev_hash, row_hash, canonicalization_version ` +
      `FROM audit_events ${where} ORDER BY created_at ASC, id ASC`;
    type Row = {
      id: string;
      workspace_id: string | null;
      actor_user_id: string | null;
      actor_type: string;
      action: string;
      object_type: string | null;
      object_id: string | null;
      result: string;
      request_id: string | null;
      ip_hmac: string | null;
      user_agent_hmac: string | null;
      metadata: Record<string, unknown> | null;
      created_at: Date;
      prev_hash: string | null;
      row_hash: string;
      canonicalization_version: string;
    };
    const rows = await this.pool.sql.unsafe<Row[]>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      prev_hash: r.prev_hash,
      row_hash: r.row_hash,
      canonicalization_version: r.canonicalization_version,
      canonicalFields: {
        id: r.id,
        workspace_id: r.workspace_id,
        actor_user_id: r.actor_user_id,
        actor_type: r.actor_type,
        action: r.action,
        object_type: r.object_type,
        object_id: r.object_id,
        result: r.result,
        request_id: r.request_id,
        ip_hmac: r.ip_hmac,
        user_agent_hmac: r.user_agent_hmac,
        metadata: r.metadata ?? {},
        created_at: isoStrict(r.created_at),
      },
    }));
  }

  private async fetchAllProvenance(
    after?: { afterCreatedAt: Date; afterId: string },
  ): Promise<readonly FetchedRow[]> {
    const where = after
      ? `WHERE (created_at, id) > ($1::timestamptz, $2::uuid)`
      : "";
    const params = after ? [after.afterCreatedAt, after.afterId] : [];
    const sql =
      `SELECT id, workspace_id, actor_user_id, actor_type, ` +
      `       capsule_id, run_id, action, ` +
      `       object_type, object_id, metadata, created_at, ` +
      `       prev_hash, row_hash, canonicalization_version ` +
      `FROM provenance_events ${where} ORDER BY created_at ASC, id ASC`;
    type Row = {
      id: string;
      workspace_id: string;
      actor_user_id: string | null;
      actor_type: string;
      capsule_id: string | null;
      run_id: string | null;
      action: string;
      object_type: string | null;
      object_id: string | null;
      metadata: Record<string, unknown> | null;
      created_at: Date;
      prev_hash: string | null;
      row_hash: string;
      canonicalization_version: string;
    };
    const rows = await this.pool.sql.unsafe<Row[]>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      prev_hash: r.prev_hash,
      row_hash: r.row_hash,
      canonicalization_version: r.canonicalization_version,
      canonicalFields: {
        id: r.id,
        workspace_id: r.workspace_id,
        actor_user_id: r.actor_user_id,
        actor_type: r.actor_type,
        capsule_id: r.capsule_id,
        run_id: r.run_id,
        action: r.action,
        object_type: r.object_type,
        object_id: r.object_id,
        metadata: r.metadata ?? {},
        created_at: isoStrict(r.created_at),
      },
    }));
  }

  private async fetchAllOperator(
    after?: { afterCreatedAt: Date; afterId: string },
  ): Promise<readonly FetchedRow[]> {
    // Operator events use `started_at` as their canonical creation
    // timestamp (v4 §12 / §19.3). `(started_at, id)` is the chronological
    // walk key.
    const where = after
      ? `WHERE (started_at, id) > ($1::timestamptz, $2::uuid)`
      : "";
    const params = after ? [after.afterCreatedAt, after.afterId] : [];
    const sql =
      `SELECT id, actor_user_id, capability, reason, ` +
      `       target_workspace_id, target_user_id, session_id, audit_event_id, ` +
      `       started_at, ended_at, ` +
      `       prev_hash, row_hash, canonicalization_version ` +
      `FROM operator_events ${where} ORDER BY started_at ASC, id ASC`;
    type Row = {
      id: string;
      actor_user_id: string;
      capability: string;
      reason: string;
      target_workspace_id: string | null;
      target_user_id: string | null;
      session_id: string;
      audit_event_id: string;
      started_at: Date;
      ended_at: Date | null;
      prev_hash: string | null;
      row_hash: string;
      canonicalization_version: string;
    };
    const rows = await this.pool.sql.unsafe<Row[]>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      prev_hash: r.prev_hash,
      row_hash: r.row_hash,
      canonicalization_version: r.canonicalization_version,
      canonicalFields: {
        id: r.id,
        actor_user_id: r.actor_user_id,
        capability: r.capability,
        reason: r.reason,
        target_workspace_id: r.target_workspace_id,
        target_user_id: r.target_user_id,
        session_id: r.session_id,
        audit_event_id: r.audit_event_id,
        started_at: isoStrict(r.started_at),
        ended_at: isoOrNull(r.ended_at),
      },
    }));
  }
}

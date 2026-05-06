/**
 * External WORM anchor committer — Phase 0.5 Layer 3 task L3.2.
 *
 * Closes the L3.1 chain by periodically pinning the chain tip to
 * S3 Object Lock COMPLIANCE storage per ADR-0010. Per v4 §19.3:
 *
 *   "The tip of each chain must be periodically committed to external
 *    WORM storage, transparency log, or monitoring system that the
 *    same database credential cannot modify. Frequency: every minute
 *    or every N rows, whichever occurs first. Chain verification must
 *    compare local rows against the external anchor. Tail truncation
 *    after a committed anchor must fail verification."
 *
 * Flow per `commitTip()`:
 *   1. SELECT the latest row of the target table (latest by
 *      `created_at, id` for audit/provenance; `started_at, id` for
 *      operator).
 *   2. Canonicalize an anchor body via L1.2 `canonicalize()` so a
 *      future cross-implementation verifier can reproduce byte-equal
 *      input.
 *   3. PUT the body to S3 with Object Lock COMPLIANCE.
 *   4. Construct the external_anchor_uri including `versionId=` (the
 *      L1.8 CHECK constraint enforces this; we keep it explicit in
 *      code so the gate fires on the same line that built it).
 *   5. INSERT the `log_chain_anchors` row.
 *   6. Run `AuditChainVerifier.verifyFromAnchor` to confirm the
 *      anchor row is reachable + verifiable. Failure throws loudly
 *      so the operator notices a bad anchor commit.
 *   7. Emit `log_chain.anchor_committed` audit.
 *
 * Atomicity note: if the S3 PUT succeeds but the DB INSERT fails, the
 * S3 object exists without a DB row — acceptable per ADR-0010 (orphan
 * objects are detectable by the retention sweep). If the DB INSERT
 * succeeds but verifyFromAnchor fails, the row exists but the chain
 * is broken — that's a hard error the deployment must investigate.
 */

import type { Sql } from "postgres";

import { canonicalize } from "../crypto/jcs.js";
import type { AuditLogger, AuditEventInput } from "./logger.js";
import {
  AuditChainVerifier,
  type AuditChainVerifierOptions,
  type VerifyReport,
} from "./verifier.js";
import type { AuditLogType } from "./dbWriter.js";
import type { SecureCorePool } from "../db/pool.js";
import type { S3AnchorProvider } from "./s3Provider.js";
import { SecureCoreError } from "../errors/shapes.js";

/** Mapping from L3.1 AuditLogType → SQL table name + log_chain_anchors literal. */
const TABLE_FOR_TYPE: Readonly<Record<AuditLogType, string>> = Object.freeze({
  audit: "audit_events",
  provenance: "provenance_events",
  operator: "operator_events",
});

const ORDER_COLUMN: Readonly<Record<AuditLogType, string>> = Object.freeze({
  audit: "created_at",
  provenance: "created_at",
  operator: "started_at",
});

interface TipRow {
  id: string;
  row_hash: string;
}

export interface LogChainAnchorRow {
  id: string;
  log_type: string;
  anchor_hash: string;
  anchored_row_id: string;
  external_anchor_uri: string;
  committed_by: string | null;
  committed_at: Date;
  canonicalization_version: string;
}

export interface CommitTipOptions {
  /** UUID of the operator triggering the commit. May be null for the supervisor timer. */
  readonly committedBy: string | null;
  /** Request id for audit correlation. */
  readonly requestId: string;
}

export interface AnchorCommitterOptions {
  readonly pool: SecureCorePool;
  readonly auditLogger: AuditLogger;
  readonly s3Provider: S3AnchorProvider;
  readonly logType: AuditLogType;
  /** S3 bucket. */
  readonly bucket: string;
  /** S3 key prefix; final key = `<keyPrefix>/<table>/<YYYYMMDD>/<tipId>.json`. */
  readonly keyPrefix: string;
  /** Periodic timer interval (ms). Default 60_000 (v4 §19.3 "every minute"). */
  readonly intervalMs?: number;
  /** Per-N-rows trigger. Default 10_000. Whichever fires first. */
  readonly rowThreshold?: number;
  readonly now?: () => number;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_ROW_THRESHOLD = 10_000;

function isoUtc(date: Date): string {
  return date.toISOString();
}

function yyyymmdd(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("");
}

function buildAnchorUri(bucket: string, key: string, versionId: string): string {
  // L1.8 CHECK constraint requires the substring `versionId=`. Keep
  // the construction local so review can see it.
  const safeBucket = encodeURIComponent(bucket);
  const safeKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `s3://${safeBucket}/${safeKey}?versionId=${encodeURIComponent(versionId)}`;
}

export class AnchorCommitter {
  readonly #pool: SecureCorePool;
  readonly #auditLogger: AuditLogger;
  readonly #s3: S3AnchorProvider;
  readonly #logType: AuditLogType;
  readonly #table: string;
  readonly #orderColumn: string;
  readonly #bucket: string;
  readonly #keyPrefix: string;
  readonly #intervalMs: number;
  readonly #rowThreshold: number;
  readonly #now: () => number;
  readonly #verifier: AuditChainVerifier;
  #timer: NodeJS.Timeout | null = null;

  public constructor(opts: AnchorCommitterOptions) {
    if (!opts.bucket || opts.bucket.length === 0) {
      throw new Error("AnchorCommitter: bucket is required");
    }
    if (!opts.keyPrefix || opts.keyPrefix.length === 0) {
      throw new Error("AnchorCommitter: keyPrefix is required");
    }
    this.#pool = opts.pool;
    this.#auditLogger = opts.auditLogger;
    this.#s3 = opts.s3Provider;
    this.#logType = opts.logType;
    this.#table = TABLE_FOR_TYPE[opts.logType];
    this.#orderColumn = ORDER_COLUMN[opts.logType];
    this.#bucket = opts.bucket;
    this.#keyPrefix = opts.keyPrefix.replace(/^\/+|\/+$/g, "");
    this.#intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#rowThreshold = opts.rowThreshold ?? DEFAULT_ROW_THRESHOLD;
    this.#now = opts.now ?? Date.now;
    const verifierOpts: AuditChainVerifierOptions = {
      pool: opts.pool,
      logType: opts.logType,
    };
    this.#verifier = new AuditChainVerifier(verifierOpts);
  }

  private async fetchTip(sql: Sql): Promise<TipRow | null> {
    // The table + order column are picked from a closed map keyed on
    // a typed enum — no caller-supplied identifier reaches `unsafe`.
    const rows = await sql.unsafe<TipRow[]>(
      `SELECT id::text AS id, row_hash
       FROM ${this.#table}
       ORDER BY ${this.#orderColumn} DESC, id DESC
       LIMIT 1`,
    );
    if (rows.length === 0) return null;
    return rows[0];
  }

  private async fetchRowCountSinceLastAnchor(sql: Sql): Promise<number> {
    const lastAnchor = await sql<Array<{ anchored_row_id: string }>>`
      SELECT anchored_row_id::text
      FROM log_chain_anchors
      WHERE log_type = ${this.#table}
      ORDER BY committed_at DESC, id DESC
      LIMIT 1
    `;
    if (lastAnchor.length === 0) {
      const all = await sql.unsafe<Array<{ n: string }>>(
        `SELECT count(*)::text AS n FROM ${this.#table}`,
      );
      return Number.parseInt(all[0]?.n ?? "0", 10);
    }
    const anchorId = lastAnchor[0].anchored_row_id;
    const since = await sql.unsafe<Array<{ n: string }>>(
      `SELECT count(*)::text AS n
       FROM ${this.#table}
       WHERE ${this.#orderColumn} > (
         SELECT ${this.#orderColumn} FROM ${this.#table} WHERE id = $1::uuid
       )`,
      [anchorId],
    );
    return Number.parseInt(since[0]?.n ?? "0", 10);
  }

  /**
   * Commit the current chain tip to external WORM.
   *
   * Throws `VERSION_CONFLICT` if the chain is empty.
   * Throws `INTERNAL_ERROR` if post-commit verification fails — the
   * row is in the DB but the chain is broken.
   */
  public async commitTip(opts: CommitTipOptions): Promise<LogChainAnchorRow> {
    const sql = this.#pool.sql;
    const tip = await this.fetchTip(sql);
    if (tip === null) {
      throw new SecureCoreError(
        "VERSION_CONFLICT",
        "Cannot anchor an empty chain.",
        { logType: this.#logType },
      );
    }

    const committedAt = new Date(this.#now());
    const body = Buffer.from(
      canonicalize({
        log_type: this.#table,
        tip_row_id: tip.id,
        tip_row_hash: tip.row_hash,
        committed_at: isoUtc(committedAt),
      }),
      "utf-8",
    );

    const key = `${this.#keyPrefix}/${this.#table}/${yyyymmdd(committedAt)}/${tip.id}.json`;
    const putResult = await this.#s3.putObject(this.#bucket, key, body);
    const uri = buildAnchorUri(this.#bucket, key, putResult.versionId);
    if (!uri.includes("versionId=")) {
      // Defensive — encodeURIComponent on the literal `versionId=` shouldn't
      // strip the `=`, but keep the contract explicit so a future helper
      // change can't bypass the L1.8 CHECK constraint.
      throw new SecureCoreError(
        "INTERNAL_ERROR",
        "Anchor URI missing versionId= marker.",
      );
    }

    const inserted = await sql<LogChainAnchorRow[]>`
      INSERT INTO log_chain_anchors
        (id, log_type, anchor_hash, anchored_row_id, external_anchor_uri,
         committed_by, committed_at, canonicalization_version)
      VALUES
        (gen_random_uuid(), ${this.#table}, ${tip.row_hash}, ${tip.id}::uuid,
         ${uri}, ${opts.committedBy}, ${committedAt}, 'jcs-v1')
      RETURNING
        id::text, log_type, anchor_hash, anchored_row_id::text,
        external_anchor_uri, committed_by::text, committed_at,
        canonicalization_version
    `;
    const row = inserted[0];

    // Sanity: re-verify from the just-anchored row. If verification
    // fails the chain is already broken and the operator must
    // investigate. The row is left in place so the failure is
    // detectable on next verification too.
    const report: VerifyReport = await this.#verifier.verifyFromAnchor(
      tip.id,
      tip.row_hash,
    );
    if (!report.ok) {
      throw new SecureCoreError(
        "INTERNAL_ERROR",
        "Anchor segment failed verification.",
        { failureReason: report.failureReason, anchorId: row.id },
      );
    }

    const audit: AuditEventInput = {
      workspaceId: null,
      actorUserId: opts.committedBy,
      actorType: opts.committedBy === null ? "unauthenticated" : "operator",
      action: "log_chain.anchor_committed",
      result: "succeeded",
      requestId: opts.requestId,
      metadata: { count: 1 },
    };
    await this.#auditLogger.write(audit);

    return row;
  }

  /**
   * Commit only when the row threshold is reached. Used by app-side
   * hooks so the request path doesn't block on the timer.
   */
  public async commitIfThresholdReached(
    opts: CommitTipOptions,
  ): Promise<LogChainAnchorRow | null> {
    const since = await this.fetchRowCountSinceLastAnchor(this.#pool.sql);
    if (since < this.#rowThreshold) return null;
    return this.commitTip(opts);
  }

  /**
   * Start a periodic timer that calls `commitTip` every `intervalMs`.
   * Errors are swallowed and never crash the timer; the operator
   * notices via the missing audit row + chain divergence on next
   * verification.
   */
  public start(opts: CommitTipOptions): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.commitTip(opts).catch(() => {
        // Don't crash the timer; loud failure happens in the
        // verifier / monitoring path.
      });
    }, this.#intervalMs);
    // Don't keep Node alive solely for the anchor timer.
    if (typeof this.#timer.unref === "function") {
      this.#timer.unref();
    }
  }

  public stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}

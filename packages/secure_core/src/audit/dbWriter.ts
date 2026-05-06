/**
 * Audit / provenance / operator DB writer — Phase 0.5 Layer-3 (L3.1).
 *
 * Wires the L1.7 `AuditLogger` DI seam to a real Postgres backend:
 *
 *   - `writer(row)` performs a single-row INSERT into the table that
 *     matches the constructor's `logType` discriminator. It does NOT
 *     wrap the insert in its own transaction — `AuditLogger.write()`
 *     emits one row at a time, and Layer-3 callers that need a single
 *     transaction spanning audit + business rows hold the tx context
 *     themselves and pass an alternate writer.
 *   - `prevHashGetter()` selects the most-recently-committed
 *     `row_hash` from the same table (`ORDER BY created_at DESC LIMIT 1`)
 *     and returns `null` for an empty table — the chain's first row.
 *
 * Field-name remap: `AuditLogger` builds rows in the snake_case form
 * v4 §12 / §19.3 specifies, so the writer can spread the row object
 * straight into a parameterized INSERT without renaming columns.
 *
 * Concurrency note: the L1.7 doc requires the application surface to
 * hold a serializable lock (or per-role advisory lock) for the duration
 * of a write so two concurrent writers cannot share a `prev_hash`. That
 * lock lives in the Layer-3 caller; this writer does not take or release
 * any lock by itself.
 *
 * Cross-task: L3.2 (anchor committer) consumes the same `pool` shape and
 * inserts into `log_chain_anchors`. The L3.1 verifier reads anchors L3.2
 * writes; the writer here does not touch the anchor table.
 *
 * Source: v4 §19.3 (Hash Chain), §19.4 (Logging Hygiene), §19.5
 * (Required Audit Events).
 */

import type postgres from "postgres";

import { CANONICALIZATION_VERSION } from "../crypto/jcs.js";
import type { SecureCorePool } from "../db/pool.js";
import type { PreparedAuditRow } from "./logger.js";

/**
 * postgres-js's `JSONValue` is strict about runtime types
 * (rejects symbols / bigints / non-plain objects). The metadata that
 * lands here has already passed `redactMetadata` (L1.7) and JCS
 * canonicalization (L1.2), both of which refuse the runtime types
 * postgres-js's `JSONValue` excludes. We cast at this seam to keep the
 * call site readable without re-validating shapes the upstream gates
 * have already verified.
 */
function asJsonbParam(
  value: Record<string, unknown>,
): postgres.JSONValue {
  return value as postgres.JSONValue;
}

/**
 * Discriminator for the three hash-chained log tables. Mirrors the
 * `log_chain_anchors.log_type` CHECK constraint in v4 §12.
 */
export type AuditLogType = "audit" | "provenance" | "operator";

/**
 * Prepared provenance row. L1.7 ships `PreparedAuditRow` for
 * `audit_events`; the analogous logger for `provenance_events` is
 * scheduled with the rest of L3 surface, so we declare the row shape
 * locally. Field set matches v4 §19.3 + the schema in `db/schema.ts`.
 */
export interface PreparedProvenanceRow {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  actor_type: "human" | "ai_agent" | "worker" | "operator";
  capsule_id: string | null;
  run_id: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  prev_hash: string | null;
  row_hash: string;
  canonicalization_version: typeof CANONICALIZATION_VERSION;
}

/**
 * Prepared operator-event row. Field set matches v4 §19.3 + the schema
 * in `db/schema.ts` (note the V4-R7 `audit_event_id` FK).
 */
export interface PreparedOperatorRow {
  id: string;
  actor_user_id: string;
  capability:
    | "platform:audit_read"
    | "platform:incident_investigate"
    | "platform:incident_remediate";
  reason: string;
  target_workspace_id: string | null;
  target_user_id: string | null;
  session_id: string;
  audit_event_id: string;
  started_at: string;
  ended_at: string | null;
  prev_hash: string | null;
  row_hash: string;
  canonicalization_version: typeof CANONICALIZATION_VERSION;
}

export type PreparedLogRow =
  | PreparedAuditRow
  | PreparedProvenanceRow
  | PreparedOperatorRow;

export interface AuditDbWriterOptions {
  pool: SecureCorePool;
  logType: AuditLogType;
}

/**
 * Map `AuditLogType` to the SQL identifier of its hash-chained table.
 * Used to build a fixed table name into otherwise-parameterized SQL.
 *
 * The mapping is closed; the union narrows to one of three string
 * literals which we hard-code below. `unsafe()` is never called with
 * caller-controlled input — only with these three pinned identifiers.
 */
function tableNameFor(logType: AuditLogType): string {
  switch (logType) {
    case "audit":
      return "audit_events";
    case "provenance":
      return "provenance_events";
    case "operator":
      return "operator_events";
  }
}

/**
 * Single-row INSERT writer + chain-tip reader for the three
 * hash-chained log tables. One instance per (pool, logType) pair; the
 * Layer-3 wiring constructs three at boot — one for each log type — and
 * hands `writer` / `prevHashGetter` to the matching logger.
 */
export class AuditDbWriter {
  private readonly pool: SecureCorePool;
  private readonly logType: AuditLogType;
  private readonly tableName: string;

  public constructor(opts: AuditDbWriterOptions) {
    this.pool = opts.pool;
    this.logType = opts.logType;
    this.tableName = tableNameFor(opts.logType);
  }

  /**
   * Insert a prepared row into the matching log table. The row's
   * snake_case fields map 1:1 to the table's column names — no
   * remapping happens here. Returns void to match the L1.7
   * `AuditWriter` interface; `AuditLogger.write()` returns the row it
   * built rather than the row the DB persisted (they are byte-equal by
   * construction — `prev_hash` and `row_hash` are computed in the
   * logger before the write, and the canonical fields cannot be
   * silently rewritten by the DB because none of them have defaults).
   *
   * The dispatch is per-`logType` because each table's column set
   * differs and Postgres does not support a polymorphic
   * `INSERT INTO $1`.
   */
  public writer = async (row: PreparedLogRow): Promise<void> => {
    switch (this.logType) {
      case "audit":
        await this.insertAudit(row as PreparedAuditRow);
        return;
      case "provenance":
        await this.insertProvenance(row as PreparedProvenanceRow);
        return;
      case "operator":
        await this.insertOperator(row as PreparedOperatorRow);
        return;
    }
  };

  /**
   * Return the `row_hash` of the most-recently-committed row in the
   * matching log table. `null` for an empty table — the chain's first
   * write.
   *
   * Ordering: `created_at DESC, id DESC`. The secondary `id DESC`
   * disambiguates rows that share a microsecond-truncated timestamp
   * (Postgres TIMESTAMPTZ has microsecond precision; the logger
   * generates millisecond-precision timestamps, so collisions are
   * possible under load when multiple writers hold the lock briefly).
   */
  public prevHashGetter = async (): Promise<string | null> => {
    const rows = await this.pool.sql.unsafe<{ row_hash: string }[]>(
      `SELECT row_hash FROM ${this.tableName} ` +
        `ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0].row_hash;
  };

  private async insertAudit(row: PreparedAuditRow): Promise<void> {
    await this.pool.sql`
      INSERT INTO audit_events (
        id, workspace_id, actor_user_id, actor_type, action,
        object_type, object_id, result, request_id,
        ip_hmac, user_agent_hmac, metadata, created_at,
        prev_hash, row_hash, canonicalization_version
      ) VALUES (
        ${row.id},
        ${row.workspace_id},
        ${row.actor_user_id},
        ${row.actor_type},
        ${row.action},
        ${row.object_type},
        ${row.object_id},
        ${row.result},
        ${row.request_id},
        ${row.ip_hmac},
        ${row.user_agent_hmac},
        ${this.pool.sql.json(asJsonbParam(row.metadata))},
        ${row.created_at},
        ${row.prev_hash},
        ${row.row_hash},
        ${row.canonicalization_version}
      )
    `;
  }

  private async insertProvenance(row: PreparedProvenanceRow): Promise<void> {
    await this.pool.sql`
      INSERT INTO provenance_events (
        id, workspace_id, actor_user_id, actor_type,
        capsule_id, run_id, action,
        object_type, object_id, metadata, created_at,
        prev_hash, row_hash, canonicalization_version
      ) VALUES (
        ${row.id},
        ${row.workspace_id},
        ${row.actor_user_id},
        ${row.actor_type},
        ${row.capsule_id},
        ${row.run_id},
        ${row.action},
        ${row.object_type},
        ${row.object_id},
        ${this.pool.sql.json(asJsonbParam(row.metadata))},
        ${row.created_at},
        ${row.prev_hash},
        ${row.row_hash},
        ${row.canonicalization_version}
      )
    `;
  }

  private async insertOperator(row: PreparedOperatorRow): Promise<void> {
    await this.pool.sql`
      INSERT INTO operator_events (
        id, actor_user_id, capability, reason,
        target_workspace_id, target_user_id, session_id, audit_event_id,
        started_at, ended_at,
        prev_hash, row_hash, canonicalization_version
      ) VALUES (
        ${row.id},
        ${row.actor_user_id},
        ${row.capability},
        ${row.reason},
        ${row.target_workspace_id},
        ${row.target_user_id},
        ${row.session_id},
        ${row.audit_event_id},
        ${row.started_at},
        ${row.ended_at},
        ${row.prev_hash},
        ${row.row_hash},
        ${row.canonicalization_version}
      )
    `;
  }
}

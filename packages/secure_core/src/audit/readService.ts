/**
 * Audit + provenance read service — Phase 0.5 Layer 4 task L4.7.
 *
 * v4 §10.2 endpoints:
 *
 *   GET /workspaces/:workspaceId/audit-events
 *   GET /workspaces/:workspaceId/provenance-events
 *
 * Per v4 §12.1.3 Option A, only the dedicated `secure_core_audit_read`
 * Postgres role can SELECT `audit_events` / `provenance_events`. The
 * application role used by the rest of secure_core has INSERT-only on
 * those tables. This service therefore takes a `SecureCorePool` whose
 * role MUST be `audit_read` — the constructor enforces it. The L4.7
 * route plugin wires the audit-read pool here; everywhere else in the
 * codebase keeps using the app-role pool.
 *
 * Pagination is keyset: queries fetch `limit + 1` rows ordered by
 * `(created_at DESC, id DESC)`. If the (limit+1)th row is returned, it
 * is DROPPED, and the Nth (last surviving) row's `(created_at, id)`
 * becomes the `next_cursor`. The page-N+1 query uses
 * `(created_at, id) < (cursor.createdAt, cursor.id)` so the cursor row
 * itself is excluded — no gaps, no overlap. When no (limit+1)th row is
 * returned the response omits `next_cursor` (terminal page).
 *
 * Output rows are intentionally NOT a spread of the DB row: the route
 * surface omits `prev_hash`, `row_hash`, and `canonicalization_version`
 * (chain-internal, only the verifier reads them). Hand-built shapes
 * keep that filter explicit.
 *
 * Metadata flows through `redactMetadata` (L1.7) on the read path as
 * defense-in-depth: the row was already redacted at write time, but a
 * future schema change or a manually-inserted row could leak; re-
 * redacting here closes the gap. A row whose stored metadata fails the
 * allowlist surfaces with `metadata: {}` rather than 500-ing the whole
 * response.
 */

import type { Sql } from "postgres";

import type { SecureCorePool } from "../db/pool.js";
import { redactMetadata, RedactionError } from "./redaction.js";

/**
 * Output row for `audit_events`. Field set is the v4 §12 column list
 * MINUS the chain-internal columns (`prev_hash`, `row_hash`,
 * `canonicalization_version`) and the HMAC-of-secrets columns
 * (`ip_hmac`, `user_agent_hmac`) which are operator-only per v4 §22.2.
 */
export interface AuditEventOutputRow {
  readonly id: string;
  readonly actor_user_id: string | null;
  readonly actor_type: string;
  readonly action: string;
  readonly object_type: string | null;
  readonly object_id: string | null;
  readonly result: string;
  readonly request_id: string | null;
  readonly created_at: string;
  readonly metadata: Record<string, unknown>;
}

/**
 * Output row for `provenance_events`. Distinct from the audit shape:
 * provenance rows carry `capsule_id` + `run_id` and have NO `result` or
 * `request_id` columns (v4 §12 schema). Defining the shape separately
 * avoids leaking either column set into the wrong endpoint.
 */
export interface ProvenanceEventOutputRow {
  readonly id: string;
  readonly actor_user_id: string | null;
  readonly actor_type: string;
  readonly capsule_id: string | null;
  readonly run_id: string | null;
  readonly action: string;
  readonly object_type: string | null;
  readonly object_id: string | null;
  readonly created_at: string;
  readonly metadata: Record<string, unknown>;
}

/** Opaque cursor — the keyset position of the LAST returned row. */
export interface KeysetCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface ListAuditEventsOptions {
  readonly limit: number;
  readonly cursor?: KeysetCursor;
}

export interface ListAuditEventsResult {
  readonly rows: AuditEventOutputRow[];
  readonly nextCursor: KeysetCursor | null;
}

export interface ListProvenanceEventsResult {
  readonly rows: ProvenanceEventOutputRow[];
  readonly nextCursor: KeysetCursor | null;
}

export interface AuditReadServiceOptions {
  /** MUST be a pool whose role is `audit_read`. The ctor checks it. */
  readonly auditReadPool: SecureCorePool;
}

/**
 * Raw row shapes returned from the SELECT statements below. Postgres-js
 * decodes `jsonb` into a JS object, `timestamptz` into a `Date`, and
 * leaves `text` / `uuid` as strings. `metadata` is `unknown` because we
 * pass it through `redactMetadata` before exposing it.
 */
interface RawAuditRow {
  id: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  object_type: string | null;
  object_id: string | null;
  result: string;
  request_id: string | null;
  created_at: Date;
  metadata: unknown;
}

interface RawProvenanceRow {
  id: string;
  actor_user_id: string | null;
  actor_type: string;
  capsule_id: string | null;
  run_id: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  created_at: Date;
  metadata: unknown;
}

/**
 * Run a `metadata` value through the L1.7 redactor as defense-in-depth.
 * `null` / non-object → `{}`; redactor refusals → `{}` (we do not 500
 * the whole list because of a single malformed row).
 */
function safeRedact(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  try {
    return redactMetadata(value);
  } catch (err) {
    if (err instanceof RedactionError) {
      return {};
    }
    throw err;
  }
}

function toAuditOutput(row: RawAuditRow): AuditEventOutputRow {
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    actor_type: row.actor_type,
    action: row.action,
    object_type: row.object_type,
    object_id: row.object_id,
    result: row.result,
    request_id: row.request_id,
    created_at: row.created_at.toISOString(),
    metadata: safeRedact(row.metadata),
  };
}

function toProvenanceOutput(row: RawProvenanceRow): ProvenanceEventOutputRow {
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    actor_type: row.actor_type,
    capsule_id: row.capsule_id,
    run_id: row.run_id,
    action: row.action,
    object_type: row.object_type,
    object_id: row.object_id,
    created_at: row.created_at.toISOString(),
    metadata: safeRedact(row.metadata),
  };
}

/**
 * Service surface for the two read endpoints. Pure SELECT-only — the
 * route layer never calls anything else on this object, and the class
 * has no INSERT/UPDATE/DELETE methods to call by design.
 */
export class AuditReadService {
  private readonly sql: Sql;

  public constructor(opts: AuditReadServiceOptions) {
    if (opts.auditReadPool.role !== "audit_read") {
      throw new Error(
        `AuditReadService requires a SecureCorePool with role="audit_read"; ` +
          `got role="${opts.auditReadPool.role}". v4 §12.1.3 forbids the app ` +
          `role from SELECTing audit tables.`,
      );
    }
    this.sql = opts.auditReadPool.sql;
  }

  public async listAuditEvents(
    workspaceId: string,
    opts: ListAuditEventsOptions,
  ): Promise<ListAuditEventsResult> {
    const fetchLimit = opts.limit + 1;
    const rows = opts.cursor === undefined
      ? await this.sql<RawAuditRow[]>`
          SELECT
            id, actor_user_id, actor_type, action,
            object_type, object_id, result, request_id,
            created_at, metadata
          FROM audit_events
          WHERE workspace_id = ${workspaceId}
          ORDER BY created_at DESC, id DESC
          LIMIT ${fetchLimit}
        `
      : await this.sql<RawAuditRow[]>`
          SELECT
            id, actor_user_id, actor_type, action,
            object_type, object_id, result, request_id,
            created_at, metadata
          FROM audit_events
          WHERE workspace_id = ${workspaceId}
            AND (created_at, id) < (${opts.cursor.createdAt}, ${opts.cursor.id})
          ORDER BY created_at DESC, id DESC
          LIMIT ${fetchLimit}
        `;

    const hasMore = rows.length > opts.limit;
    const surviving = hasMore ? rows.slice(0, opts.limit) : rows;
    const nextCursor = hasMore && surviving.length > 0
      ? {
          createdAt: surviving[surviving.length - 1].created_at,
          id: surviving[surviving.length - 1].id,
        }
      : null;

    return {
      rows: surviving.map(toAuditOutput),
      nextCursor,
    };
  }

  public async listProvenanceEvents(
    workspaceId: string,
    opts: ListAuditEventsOptions,
  ): Promise<ListProvenanceEventsResult> {
    const fetchLimit = opts.limit + 1;
    const rows = opts.cursor === undefined
      ? await this.sql<RawProvenanceRow[]>`
          SELECT
            id, actor_user_id, actor_type,
            capsule_id, run_id, action,
            object_type, object_id, created_at, metadata
          FROM provenance_events
          WHERE workspace_id = ${workspaceId}
          ORDER BY created_at DESC, id DESC
          LIMIT ${fetchLimit}
        `
      : await this.sql<RawProvenanceRow[]>`
          SELECT
            id, actor_user_id, actor_type,
            capsule_id, run_id, action,
            object_type, object_id, created_at, metadata
          FROM provenance_events
          WHERE workspace_id = ${workspaceId}
            AND (created_at, id) < (${opts.cursor.createdAt}, ${opts.cursor.id})
          ORDER BY created_at DESC, id DESC
          LIMIT ${fetchLimit}
        `;

    const hasMore = rows.length > opts.limit;
    const surviving = hasMore ? rows.slice(0, opts.limit) : rows;
    const nextCursor = hasMore && surviving.length > 0
      ? {
          createdAt: surviving[surviving.length - 1].created_at,
          id: surviving[surviving.length - 1].id,
        }
      : null;

    return {
      rows: surviving.map(toProvenanceOutput),
      nextCursor,
    };
  }
}

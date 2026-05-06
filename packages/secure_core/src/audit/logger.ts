/**
 * Audit logger — Phase 0.5 Layer-1 (L1.7).
 *
 * The single typed entry point every code path uses to emit an audit
 * event. v4 §19 requires:
 *
 *   - Server-derived actor fields (§19.1) — the API never reads
 *     `actor` from a request body. The caller passes it in; the API
 *     handlers in Layer-3 derive it from `req.auth`.
 *   - HMAC'd IP / user-agent (§19.2) — done by the caller via
 *     `src/crypto/hmac.ts`; we accept opaque hex strings.
 *   - Hash chain (§19.3) — every row carries `prev_hash`, `row_hash`,
 *     and `canonicalization_version`. The `row_hash` is
 *     SHA-256 over a JCS-canonicalized object that includes the
 *     `prev_hash` and the canonicalized field set per §19.3.
 *   - Logging hygiene (§19.4) — metadata is redacted at the
 *     boundary; non-allowlisted keys fail closed.
 *
 * The DB write is injected via `writer`; this module is pure
 * preparation + chain math. Layer-3 wires the writer to a Drizzle
 * insert on `audit_events`. The DI seam keeps the unit test free of
 * Postgres while still exercising the full canonicalization +
 * hashing path.
 */

import { createHash } from "node:crypto";
import { canonicalize, CANONICALIZATION_VERSION } from "../crypto/jcs.js";
import { isAuditEvent, type AuditEvent } from "../config/audit_events.js";
import { redactMetadata, RedactionError } from "./redaction.js";

/**
 * Closed enum for `audit_events.actor_type`. `unauthenticated` covers
 * the V4-R3 case: pre-auth events (login.failed, csrf.failed,
 * origin.mismatch from an unauthenticated browser) MUST still emit
 * audit rows even though no user id is available.
 */
export type AuditActorType =
  | "human"
  | "ai_agent"
  | "worker"
  | "operator"
  | "unauthenticated";

/**
 * Closed enum for `audit_events.result`. Mirrors `AUDIT_RESULTS` from
 * `src/config/audit_events.ts`; redeclared here as a type to keep the
 * input shape self-contained.
 */
export type AuditResult = "succeeded" | "denied" | "failed";

/**
 * Caller-supplied event shape. Every field is server-derived in the
 * actual API; nothing here corresponds to a request body field.
 *
 * `workspaceId` is `null` for pre-auth events and platform-scope
 * events (e.g. `secret.rotated`). `actorUserId` is `null` exactly
 * when `actorType === 'unauthenticated'`.
 */
export interface AuditEventInput {
  workspaceId: string | null;
  actorUserId: string | null;
  actorType: AuditActorType;
  action: AuditEvent;
  objectType?: string;
  objectId?: string;
  result: AuditResult;
  requestId: string;
  ipHmac?: string;
  userAgentHmac?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The fully-prepared row Layer-3 inserts into `audit_events`.
 * Field names are snake_case to match the DB column names per
 * v4 §12 / §19.3 — Layer-3 spreads this object directly into the
 * Drizzle insert.
 *
 * The chain fields (`prev_hash`, `row_hash`, `canonicalization_version`)
 * are NOT canonicalized into `row_hash` itself per §19.3 — they sit
 * alongside the canonicalized payload.
 */
export interface PreparedAuditRow {
  id: string;
  workspace_id: string | null;
  actor_user_id: string | null;
  actor_type: AuditActorType;
  action: AuditEvent;
  object_type: string | null;
  object_id: string | null;
  result: AuditResult;
  request_id: string;
  ip_hmac: string | null;
  user_agent_hmac: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  prev_hash: string | null;
  row_hash: string;
  canonicalization_version: typeof CANONICALIZATION_VERSION;
}

/**
 * Layer-3 wires `writer` to a Drizzle insert; the unit test wires
 * it to an in-memory array.
 */
export type AuditWriter = (row: PreparedAuditRow) => Promise<void>;

/**
 * Layer-3 wires `prevHashGetter` to a SELECT against `audit_events`
 * for the most-recently-committed row's `row_hash`. Returns `null`
 * for the first row in a fresh DB.
 *
 * The Layer-3 implementation MUST hold a serializable lock (or the
 * audit-events-only writer role's advisory lock) for the duration of
 * a write so two concurrent writers can't share a `prev_hash` —
 * see v4 §19.3 closing paragraph.
 */
export type AuditPrevHashGetter = () => Promise<string | null>;

export interface AuditLoggerOptions {
  writer: AuditWriter;
  prevHashGetter: AuditPrevHashGetter;
  /**
   * Optional clock + UUID injection for deterministic tests. Default
   * uses `crypto.randomUUID` and `new Date().toISOString()`.
   */
  now?: () => Date;
  generateId?: () => string;
}

/**
 * UUID generator. Node 24/25's `crypto.randomUUID` returns a v4
 * UUID; v4 §12 schema column accepts any UUID string, so v4 is fine
 * for now. UUID v7 (time-ordered) is preferred long-term because it
 * gives audit rows a natural insertion-order index without relying on
 * a monotonic `created_at`. When Node ships a v7 generator (or we
 * adopt `uuid` from npm in a Layer-2 task), swap this and add a
 * regression test that the version digit is `7`.
 */
function defaultGenerateId(): string {
  return crypto.randomUUID();
}

function defaultNow(): Date {
  return new Date();
}

/**
 * Build the canonicalized payload per v4 §19.3 for `audit_events`.
 * The field order doesn't matter (JCS sorts keys), but every field
 * the spec lists must be present, with explicit `null` for missing
 * optional fields (NULL handling MUST be explicit per §19.3).
 */
function canonicalFieldsForAuditEvent(row: {
  id: string;
  workspace_id: string | null;
  actor_user_id: string | null;
  actor_type: AuditActorType;
  action: AuditEvent;
  object_type: string | null;
  object_id: string | null;
  result: AuditResult;
  request_id: string;
  ip_hmac: string | null;
  user_agent_hmac: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    actor_user_id: row.actor_user_id,
    actor_type: row.actor_type,
    action: row.action,
    object_type: row.object_type,
    object_id: row.object_id,
    result: row.result,
    request_id: row.request_id,
    ip_hmac: row.ip_hmac,
    user_agent_hmac: row.user_agent_hmac,
    metadata: row.metadata,
    created_at: row.created_at,
  };
}

/**
 * Compute `row_hash` per v4 §19.3: SHA-256 of the JCS canonicalized
 * `{ prev_hash, ...canonical_fields, canonicalization_version }`.
 * Exposed for the test that recomputes the hash independently to
 * pin chain reproducibility.
 */
export function computeAuditRowHash(args: {
  prevHash: string | null;
  canonicalFields: Record<string, unknown>;
}): string {
  const payload = {
    prev_hash: args.prevHash,
    ...args.canonicalFields,
    canonicalization_version: CANONICALIZATION_VERSION,
  };
  const canonical = canonicalize(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Typed audit logger. Construct once at app boot; call `write` from
 * every emission site. The class itself holds no DB connection — the
 * `writer` and `prevHashGetter` are the only IO seams.
 */
export class AuditLogger {
  private readonly writer: AuditWriter;
  private readonly prevHashGetter: AuditPrevHashGetter;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  public constructor(opts: AuditLoggerOptions) {
    this.writer = opts.writer;
    this.prevHashGetter = opts.prevHashGetter;
    this.now = opts.now ?? defaultNow;
    this.generateId = opts.generateId ?? defaultGenerateId;
  }

  /**
   * Prepare and persist a single audit event. The order is:
   *
   *   1. Validate the action against the closed `AuditEvent` union.
   *      Defense-in-depth against an `as AuditEvent` cast at the
   *      call site.
   *   2. Validate actor/user-id consistency: `unauthenticated` means
   *      `actorUserId` is `null`; every other actor type means
   *      `actorUserId` is non-null.
   *   3. Redact metadata. Non-allowlisted or forbidden-named keys
   *      raise `RedactionError`.
   *   4. Generate id + RFC 3339 UTC timestamp.
   *   5. Build the canonicalized field set (v4 §19.3).
   *   6. Fetch the chain tip; compute `row_hash`.
   *   7. Hand the finished row to `writer` exactly once.
   *
   * Throws `RedactionError` for metadata refusals and `Error` (with
   * a typed `code` property) for shape refusals, so Layer-3 can map
   * each to the §3 envelope.
   */
  public async write(event: AuditEventInput): Promise<PreparedAuditRow> {
    if (!isAuditEvent(event.action)) {
      throw new RedactionError(
        "audit.invalid_metadata_shape",
        `unknown audit action "${String(event.action)}"; add it to src/config/audit_events.ts in the same commit as v4 §19.5`,
      );
    }

    if (event.actorType === "unauthenticated") {
      if (event.actorUserId !== null) {
        throw new RedactionError(
          "audit.invalid_metadata_shape",
          "actorUserId must be null when actorType === 'unauthenticated'",
        );
      }
    } else {
      if (event.actorUserId === null) {
        throw new RedactionError(
          "audit.invalid_metadata_shape",
          `actorUserId must be non-null when actorType === '${event.actorType}'`,
        );
      }
    }

    if (typeof event.requestId !== "string" || event.requestId.length === 0) {
      throw new RedactionError(
        "audit.invalid_metadata_shape",
        "requestId is required and must be a non-empty string",
      );
    }

    // `event.metadata === undefined` is the "no metadata" shorthand
    // and produces an empty object. Any other value — including
    // `null`, arrays, primitives — must round-trip through
    // `redactMetadata` so the shape refusal is typed.
    const redactedMetadata =
      event.metadata === undefined ? {} : redactMetadata(event.metadata);

    const id = this.generateId();
    // RFC 3339 UTC per §19.3. `Date.toISOString()` always emits
    // millisecond precision, e.g. "2026-05-04T18:32:11.123Z".
    const createdAt = this.now().toISOString();

    const canonicalFields = canonicalFieldsForAuditEvent({
      id,
      workspace_id: event.workspaceId,
      actor_user_id: event.actorUserId,
      actor_type: event.actorType,
      action: event.action,
      object_type: event.objectType ?? null,
      object_id: event.objectId ?? null,
      result: event.result,
      request_id: event.requestId,
      ip_hmac: event.ipHmac ?? null,
      user_agent_hmac: event.userAgentHmac ?? null,
      metadata: redactedMetadata,
      created_at: createdAt,
    });

    const prevHash = await this.prevHashGetter();
    const rowHash = computeAuditRowHash({ prevHash, canonicalFields });

    const prepared: PreparedAuditRow = {
      id,
      workspace_id: event.workspaceId,
      actor_user_id: event.actorUserId,
      actor_type: event.actorType,
      action: event.action,
      object_type: event.objectType ?? null,
      object_id: event.objectId ?? null,
      result: event.result,
      request_id: event.requestId,
      ip_hmac: event.ipHmac ?? null,
      user_agent_hmac: event.userAgentHmac ?? null,
      metadata: redactedMetadata,
      created_at: createdAt,
      prev_hash: prevHash,
      row_hash: rowHash,
      canonicalization_version: CANONICALIZATION_VERSION,
    };

    await this.writer(prepared);

    return prepared;
  }
}

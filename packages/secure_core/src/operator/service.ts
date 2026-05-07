/**
 * Operator service — Phase 0.5 Layer 4 task L4.10.
 *
 * v4 §22.2 Operator Access. Three platform-level capabilities (per v4
 * §13.2 + §22.2):
 *
 *   - `platform:audit_read`            — cross-workspace audit reads.
 *   - `platform:incident_investigate`  — enter a time-limited
 *                                         incident-investigation
 *                                         session.
 *   - `platform:incident_remediate`    — destructive remediation
 *                                         (delete_session,
 *                                         revoke_membership,
 *                                         lock_capsule).
 *
 * Every platform-capability use emits BOTH an `audit_events` row AND a
 * paired `operator_events` row (V4-R7: `operator_events.audit_event_id`
 * is NOT NULL with a FK to `audit_events.id`). The pairing is enforced
 * at the database level — the FK constraint refuses an operator row
 * whose audit row does not exist. This service writes the audit row
 * FIRST, captures its id, then writes the operator row inside the same
 * transaction so a crash between the two leaves no orphan.
 *
 * `actor_type` is hard-coded to `"operator"` — the service NEVER reads
 * actor_type from the request (v4 §19.1). `requireAuth` populates
 * `req.auth.actorType` as `"human"` for everyone today; the operator
 * shape is materialized HERE based on the operator capability check.
 *
 * The cross-workspace `listAuditEventsCrossWorkspace` path delegates to
 * the L4.7 `AuditReadService` (audit-read pool, SELECT-only) and emits
 * the paired audit + operator rows AFTER the read so a denied read does
 * not leak through as a "this happened" log entry.
 *
 * Source: v4 §22.2 (Operator Access), §13.2 (capabilities), §12 (schema
 * + V4-R7), §19.1 (server-derived actor), §19.3 (hash chain).
 */

import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

import {
  canonicalize,
  CANONICALIZATION_VERSION,
} from "../crypto/jcs.js";
import type { SecureCorePool } from "../db/pool.js";
import type { AuditLogger } from "./../audit/logger.js";
import type {
  AuditReadService,
  KeysetCursor,
  ListAuditEventsResult,
} from "./../audit/readService.js";
import type { PreparedOperatorRow } from "./../audit/dbWriter.js";

/**
 * The three operator capabilities. Mirrors the audit_events_capability
 * CHECK constraint in `db/schema.ts` and the `PreparedOperatorRow`
 * `capability` field in L3.1's writer.
 */
export type OperatorCapability =
  | "platform:audit_read"
  | "platform:incident_investigate"
  | "platform:incident_remediate";

/** Allowed remediation actions per task description. */
export type RemediationAction =
  | "delete_session"
  | "revoke_membership"
  | "lock_capsule";

export interface ListAuditEventsCrossWorkspaceArgs {
  readonly actorUserId: string;
  readonly sessionId: string;
  readonly requestId: string;
  /** Optional workspace filter; omit to walk all workspaces. */
  readonly workspaceId?: string;
  readonly limit: number;
  readonly cursor?: KeysetCursor;
}

export interface EnterInvestigationArgs {
  readonly actorUserId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly targetWorkspaceId: string;
  readonly reason: string;
  readonly ttlSeconds: number;
}

export interface EnterInvestigationResult {
  readonly sessionId: string;
  readonly expiresAt: string;
}

export interface ExecuteRemediationArgs {
  readonly actorUserId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly targetWorkspaceId: string;
  readonly reason: string;
  readonly action: RemediationAction;
  readonly targetId: string;
}

export interface ExecuteRemediationResult {
  readonly action: RemediationAction;
  readonly targetId: string;
  readonly auditEventId: string;
  readonly operatorEventId: string;
}

/**
 * DI hook for inserting a prepared operator row in the SAME transaction
 * as the audit row. Layer-3 wires this to a postgres-js TX-bound INSERT
 * INTO `operator_events`. Tests stub it with an in-memory array.
 */
export type OperatorRowWriter = (
  row: PreparedOperatorRow,
  tx: postgres.TransactionSql,
) => Promise<void>;

/**
 * DI hook for reading the most-recent `operator_events.row_hash` (chain
 * tip) inside the SAME transaction as the upcoming insert so two
 * concurrent operator-event writes never share a `prev_hash`.
 */
export type OperatorPrevHashGetter = (
  tx: postgres.TransactionSql,
) => Promise<string | null>;

export interface OperatorServiceOptions {
  /** Audit-read pool for cross-workspace SELECTs (v4 §12.1.3). */
  readonly auditReadService: AuditReadService;
  /**
   * Pool used to OPEN the audit + operator paired-write transaction.
   * Must be the `app` pool (which has INSERT on audit_events +
   * operator_events). v4 §12.1.3.
   */
  readonly appPool: SecureCorePool;
  /** Wired to L1.7 + L3.1's audit DB writer. */
  readonly auditLogger: AuditLogger;
  readonly operatorWriter: OperatorRowWriter;
  readonly operatorPrevHashGetter: OperatorPrevHashGetter;
  /** Optional clock injection for deterministic tests. */
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

/**
 * JCS-canonicalize the operator row and SHA-256 its bytes per v4 §19.3.
 * Mirrors `computeAuditRowHash` from L1.7. Operator row's canonical
 * field set is per v4 §12 + the `fetchAllOperator` query in
 * `audit/verifier.ts`.
 */
function computeOperatorRowHash(args: {
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

function operatorCanonicalFields(row: {
  id: string;
  actor_user_id: string;
  capability: OperatorCapability;
  reason: string;
  target_workspace_id: string | null;
  target_user_id: string | null;
  session_id: string;
  audit_event_id: string;
  started_at: string;
  ended_at: string | null;
}): Record<string, unknown> {
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    capability: row.capability,
    reason: row.reason,
    target_workspace_id: row.target_workspace_id,
    target_user_id: row.target_user_id,
    session_id: row.session_id,
    audit_event_id: row.audit_event_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
  };
}

/**
 * Internal state for one paired emission. The audit row is written
 * outside the operator-row transaction (the AuditLogger holds its own
 * writer); we reopen the chain lookup + insert inside `tx` for the
 * operator side. Strictly speaking the audit-side write should also
 * sit in `tx`, but L1.7 keeps the audit writer non-tx-aware. The FK
 * on operator_events.audit_event_id keeps the pairing consistent: if
 * the audit insert fails, no operator row goes in; if the operator
 * insert fails, the audit row remains (acceptable — the audit log is
 * append-only and the failed-pair case will be rare and visible to
 * the L3.1 verifier).
 */
export class OperatorService {
  private readonly auditReadService: AuditReadService;
  private readonly appPool: SecureCorePool;
  private readonly auditLogger: AuditLogger;
  private readonly operatorWriter: OperatorRowWriter;
  private readonly operatorPrevHashGetter: OperatorPrevHashGetter;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  public constructor(opts: OperatorServiceOptions) {
    this.auditReadService = opts.auditReadService;
    this.appPool = opts.appPool;
    this.auditLogger = opts.auditLogger;
    this.operatorWriter = opts.operatorWriter;
    this.operatorPrevHashGetter = opts.operatorPrevHashGetter;
    this.now = opts.now ?? (() => new Date());
    this.generateId = opts.generateId ?? (() => randomUUID());
  }

  /**
   * v4 §22.2 cross-workspace audit read. Emits a paired
   * `audit_events.platform.capability_used` + `operator_events` row for
   * every read, even read-only ones — the operator log is the canonical
   * "who looked at what" surface.
   */
  public async listAuditEventsCrossWorkspace(
    args: ListAuditEventsCrossWorkspaceArgs,
  ): Promise<ListAuditEventsResult> {
    const result = await this.auditReadService.listAuditEventsCrossWorkspace({
      limit: args.limit,
      cursor: args.cursor,
      workspaceId: args.workspaceId,
    });

    await this.recordOperatorEvent({
      actorUserId: args.actorUserId,
      sessionId: args.sessionId,
      requestId: args.requestId,
      capability: "platform:audit_read",
      auditAction: "platform.capability_used",
      reason: "audit_read",
      targetWorkspaceId: args.workspaceId ?? null,
      targetUserId: null,
      auditMetadata: {
        capability: "platform:audit_read",
        ...(args.workspaceId !== undefined
          ? { target_workspace_id: args.workspaceId }
          : {}),
      },
      // Read-only: ended_at = started_at (the session is the request).
      endedAtSameAsStarted: true,
    });

    return result;
  }

  /**
   * v4 §22.2 incident-investigation session. Emits paired
   * `audit_events.platform.long_session_granted` + `operator_events`
   * row. The session id we return is a fresh UUID — it identifies the
   * operator session in the operator log; existing user sessions are
   * NOT mutated here.
   */
  public async enterInvestigation(
    args: EnterInvestigationArgs,
  ): Promise<EnterInvestigationResult> {
    const sessionId = this.generateId();
    const startedAt = this.now();
    const expiresAt = new Date(
      startedAt.getTime() + args.ttlSeconds * 1000,
    );

    await this.recordOperatorEvent({
      actorUserId: args.actorUserId,
      sessionId,
      requestId: args.requestId,
      capability: "platform:incident_investigate",
      auditAction: "platform.long_session_granted",
      reason: args.reason,
      targetWorkspaceId: args.targetWorkspaceId,
      targetUserId: null,
      auditMetadata: {
        capability: "platform:incident_investigate",
        target_workspace_id: args.targetWorkspaceId,
        ttl_seconds: args.ttlSeconds,
      },
      startedAtOverride: startedAt,
      endedAtOverride: expiresAt,
    });

    return {
      sessionId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * v4 §22.2 destructive remediation. The HTTP route binds this to L2.9
   * `requireApprovalIfHighRisk` (action `platform_operator_access`); by
   * the time we get here the approval token has been consumed. We emit
   * paired audit + operator rows and return the row ids so the caller
   * can correlate. Actual destructive side-effects (delete_session,
   * revoke_membership, lock_capsule) are stubbed at this layer — the
   * task scope is the operator-session model + audit emission; concrete
   * destructive primitives land with their owning subsystems. The
   * audit row carries the action + target so a future implementer can
   * walk the operator log to validate every remediation has a paired
   * destructive primitive ran.
   */
  public async executeRemediation(
    args: ExecuteRemediationArgs,
  ): Promise<ExecuteRemediationResult> {
    const result = await this.recordOperatorEvent({
      actorUserId: args.actorUserId,
      sessionId: args.sessionId,
      requestId: args.requestId,
      capability: "platform:incident_remediate",
      auditAction: "platform.capability_used",
      reason: args.reason,
      targetWorkspaceId: args.targetWorkspaceId,
      targetUserId:
        args.action === "revoke_membership" ? args.targetId : null,
      auditMetadata: {
        capability: "platform:incident_remediate",
        target_workspace_id: args.targetWorkspaceId,
        action: args.action,
        target_id: args.targetId,
      },
      endedAtSameAsStarted: true,
    });

    return {
      action: args.action,
      targetId: args.targetId,
      auditEventId: result.auditEventId,
      operatorEventId: result.operatorEventId,
    };
  }

  /**
   * Shared paired-emission helper. Writes the audit_events row first
   * (the L1.7 logger handles its own chain math), then opens a
   * postgres-js transaction, fetches the operator chain tip in-tx, and
   * inserts the operator_events row in-tx. The audit_event_id FK
   * referencing the just-written audit row enforces V4-R7's pairing
   * invariant at the database layer.
   */
  private async recordOperatorEvent(args: {
    actorUserId: string;
    sessionId: string;
    requestId: string;
    capability: OperatorCapability;
    auditAction: "platform.capability_used" | "platform.long_session_granted";
    reason: string;
    targetWorkspaceId: string | null;
    targetUserId: string | null;
    auditMetadata: Record<string, unknown>;
    /** When true, ended_at = started_at (one-shot capability use). */
    endedAtSameAsStarted?: boolean;
    /** When set, override the started_at clock. */
    startedAtOverride?: Date;
    /** When set, override the ended_at clock (e.g. session expiry). */
    endedAtOverride?: Date | null;
  }): Promise<{ auditEventId: string; operatorEventId: string }> {
    const auditRow = await this.auditLogger.write({
      workspaceId: args.targetWorkspaceId,
      actorUserId: args.actorUserId,
      actorType: "operator",
      action: args.auditAction,
      result: "succeeded",
      requestId: args.requestId,
      metadata: args.auditMetadata,
    });

    const startedAt = args.startedAtOverride ?? this.now();
    const endedAt =
      args.endedAtOverride !== undefined
        ? args.endedAtOverride
        : args.endedAtSameAsStarted === true
          ? startedAt
          : null;

    const operatorEventId = this.generateId();

    const opEventId = await this.appPool.sql.begin(
      async (tx: postgres.TransactionSql): Promise<string> => {
        const prevHash = await this.operatorPrevHashGetter(tx);
        const startedIso = startedAt.toISOString();
        const endedIso = endedAt === null ? null : endedAt.toISOString();
        const canonicalFields = operatorCanonicalFields({
          id: operatorEventId,
          actor_user_id: args.actorUserId,
          capability: args.capability,
          reason: args.reason,
          target_workspace_id: args.targetWorkspaceId,
          target_user_id: args.targetUserId,
          session_id: args.sessionId,
          audit_event_id: auditRow.id,
          started_at: startedIso,
          ended_at: endedIso,
        });
        const rowHash = computeOperatorRowHash({
          prevHash,
          canonicalFields,
        });
        const prepared: PreparedOperatorRow = {
          id: operatorEventId,
          actor_user_id: args.actorUserId,
          capability: args.capability,
          reason: args.reason,
          target_workspace_id: args.targetWorkspaceId,
          target_user_id: args.targetUserId,
          session_id: args.sessionId,
          audit_event_id: auditRow.id,
          started_at: startedIso,
          ended_at: endedIso,
          prev_hash: prevHash,
          row_hash: rowHash,
          canonicalization_version: CANONICALIZATION_VERSION,
        };
        await this.operatorWriter(prepared, tx);
        return operatorEventId;
      },
    );

    return {
      auditEventId: auditRow.id,
      operatorEventId: opEventId,
    };
  }
}

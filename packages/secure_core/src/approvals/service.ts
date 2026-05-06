/**
 * Approval service — Phase 0.5 Layer-3 (L3.3).
 *
 * Implements the v4 §16 approval token lifecycle: request → issue → consume,
 * with deny / revoke side-paths. Every gate the spec demands is enforced
 * here:
 *
 *   §16.1 Transport — the service does not read the raw token from any
 *     particular surface; the caller passes `presentedToken` straight from
 *     the `X-Approval-Token` header. The service hashes server-side.
 *   §16.2 Token requirements — minted via `mintToken()` (43-char base64url,
 *     ≥256 bits CSPRNG, exceeding the 128-bit floor); only the SHA-256
 *     hash is stored; comparison is constant-time; tokens expire and are
 *     revocable; XOR (user-bound XOR role-bound, never both) is enforced
 *     at issuance.
 *   §16.3 token_context_hash — HMAC-SHA-256 over JCS-canonicalized
 *     {approval_request_id, workspace_id, requested_action,
 *     approver_constraint, expires_at}. On consumption, the hash is
 *     recomputed from CURRENT row values (post-tampering catches the
 *     §16.3 mismatch path).
 *   §16.4 Atomic consumption — single UPDATE ... FROM ... WHERE pattern,
 *     pinning {used_at IS NULL, revoked_at IS NULL, expires_at > now(),
 *     parent.status = 'pending'}. Application-side time checks are
 *     diagnostic only; the DB is the gate.
 *
 * Audit hygiene: every failure path emits its specific audit event BEFORE
 * the throw, so a half-failed flow still produces a record. Success
 * emits `approval.granted`. Issuance is silent — the approval flow is
 * audited at request, decision, and consumption only.
 *
 * Cross-task notes:
 *   - L2.9 `requireApprovalIfHighRisk` consumes `consumeToken`. The
 *     header read happens in middleware; the service stays oblivious to
 *     transport.
 *   - The HMAC key is constructor-injected (Buffer). Callers fetch it
 *     from L1.6 SecretsClient; this module never reads `process.env`.
 */

import {
  hashToken,
  mintToken,
  compareTokenConstantTime,
} from "../crypto/tokens.js";
import { hmacSha256, hmacBufferEqual } from "../crypto/hmac.js";
import { canonicalize } from "../crypto/jcs.js";
import { AuditLogger } from "../audit/logger.js";
import {
  ApprovalTokenInvalidError,
  InputInvalidError,
  SecureCoreError,
} from "../errors/shapes.js";
import type { SecureCorePool } from "../db/pool.js";

/**
 * Default token TTL when the caller omits `ttlMs`. v4 §16.2.4 mandates
 * expiration but does not pin a default; one hour is conventional for
 * human-in-the-loop approval flows and matches §22 session idle timing.
 */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Row shapes — narrow projections of `approval_requests` / `approval_tokens`.
// ---------------------------------------------------------------------------

/**
 * Subset of `approval_requests` columns the service reads / returns. The
 * shape mirrors `test/fixtures/factories.ts#ApprovalRequestRow` plus the
 * fields the service mutates (`decided_by`, `decided_at`).
 */
export interface ApprovalRequestRow {
  id: string;
  workspace_id: string;
  object_type: string;
  object_id: string;
  requested_action: string;
  requested_by: string;
  requested_by_agent: boolean;
  status: string;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
}

/**
 * Subset of `approval_tokens` columns the service reads / returns.
 * `token_hash` is included so the caller can confirm the row identity if
 * needed; the raw token is exposed exactly once at `issueToken()` time.
 */
export interface ApprovalTokenRow {
  id: string;
  workspace_id: string;
  approval_request_id: string;
  token_hash: string;
  token_context_hash: string;
  approver_user_id: string | null;
  approver_role_id: string | null;
  created_by: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}

// ---------------------------------------------------------------------------
// Public method input shapes.
// ---------------------------------------------------------------------------

export interface RequestApprovalOptions {
  workspaceId: string;
  objectType: string;
  objectId: string;
  requestedAction: string;
  requestedBy: string;
  requestedByAgent: boolean;
  requestId: string;
}

export interface IssueTokenOptions {
  approvalRequestId: string;
  /** Either user-bound or role-bound; XOR enforced at issuance. */
  approverUserId: string | null;
  approverRoleId: string | null;
  createdBy: string;
  ttlMs?: number;
  requestId: string;
}

export interface ConsumeTokenOptions {
  presentedToken: string;
  expectedRequestId: string;
  expectedAction: string;
  consumerUserId: string;
  consumerRoleIds: readonly string[];
  requestId: string;
}

export interface DecideRequestOptions {
  approvalRequestId: string;
  decidedBy: string;
  requestId: string;
}

export interface ApprovalServiceOptions {
  pool: SecureCorePool;
  auditLogger: AuditLogger;
  /** HMAC key for §16.3 token_context_hash. Caller loads from L1.6. */
  approvalHmacKey: Buffer;
  /** Default expiry in ms. Default: 1h. */
  defaultTtlMs?: number;
  /** Clock seam for tests. Default: `Date.now`. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

export class ApprovalService {
  private readonly pool: SecureCorePool;
  private readonly auditLogger: AuditLogger;
  private readonly approvalHmacKey: Buffer;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  public constructor(options: ApprovalServiceOptions) {
    this.pool = options.pool;
    this.auditLogger = options.auditLogger;
    this.approvalHmacKey = options.approvalHmacKey;
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());

    if (this.approvalHmacKey.length === 0) {
      throw new InputInvalidError(
        "ApprovalService: approvalHmacKey must be non-empty.",
      );
    }
  }

  // -------------------------------------------------------------------------
  // requestApproval
  // -------------------------------------------------------------------------

  /**
   * Insert a pending `approval_requests` row and emit `approval.requested`.
   * The caller is responsible for capability/authorization checks before
   * calling — this method assumes those gates have already passed.
   */
  public async requestApproval(
    opts: RequestApprovalOptions,
  ): Promise<ApprovalRequestRow> {
    const id = crypto.randomUUID();
    const sql = this.pool.sql;

    const rows = await sql<ApprovalRequestRow[]>`
      INSERT INTO approval_requests
        (id, workspace_id, object_type, object_id, requested_action,
         requested_by, requested_by_agent, status)
      VALUES
        (${id}, ${opts.workspaceId}, ${opts.objectType}, ${opts.objectId},
         ${opts.requestedAction}, ${opts.requestedBy},
         ${opts.requestedByAgent}, 'pending')
      RETURNING id, workspace_id, object_type, object_id,
                requested_action, requested_by, requested_by_agent,
                status, decided_by, decided_at, created_at
    `;
    const row = rows[0];

    // Audit metadata is constrained to the L1.7 allowlist; we surface
    // the requesting subject as a redacted shape so the row is grep-able
    // without leaking raw identifiers per v4 §19.4.
    await this.auditLogger.write({
      workspaceId: row.workspace_id,
      actorUserId: opts.requestedBy,
      actorType: opts.requestedByAgent ? "ai_agent" : "human",
      action: "approval.requested",
      objectType: "approval_request",
      objectId: row.id,
      result: "succeeded",
      requestId: opts.requestId,
    });

    return row;
  }

  // -------------------------------------------------------------------------
  // issueToken
  // -------------------------------------------------------------------------

  /**
   * Mint a single-use approval token bound to a pending request. Returns
   * `{ rawToken, tokenRow }` — the caller transmits `rawToken` to the
   * approver out-of-band (email link, signed envelope) and never logs it.
   *
   * Issuance does NOT emit an audit event by itself — the lifecycle is
   * audited at request / decision / consumption boundaries (§19.5).
   */
  public async issueToken(
    opts: IssueTokenOptions,
  ): Promise<{ rawToken: string; tokenRow: ApprovalTokenRow }> {
    // §16.2.4: user-bound XOR role-bound. The DB CHECK only enforces OR.
    const userBound = opts.approverUserId !== null;
    const roleBound = opts.approverRoleId !== null;
    if (userBound === roleBound) {
      throw new InputInvalidError(
        userBound
          ? "issueToken: approverUserId and approverRoleId are mutually exclusive."
          : "issueToken: exactly one of approverUserId or approverRoleId must be set.",
      );
    }

    const ttlMs = opts.ttlMs ?? this.defaultTtlMs;
    if (ttlMs <= 0) {
      throw new InputInvalidError(
        "issueToken: ttlMs must be positive.",
      );
    }

    const sql = this.pool.sql;

    // Pin the parent row's pending state inside the same statement that
    // INSERTs the token. The conditional INSERT-FROM-SELECT-WHERE pattern
    // mirrors the §16.4 atomic consumption pattern: if the request has
    // moved out of pending, we insert zero rows and refuse cleanly.
    const id = crypto.randomUUID();
    const rawToken = mintToken();
    const tokenHashHex = hashToken(rawToken);
    const expiresAt = new Date(this.now() + ttlMs);

    // Look up the parent in a separate SELECT first — we need its
    // `workspace_id` and `requested_action` to compute the context hash.
    // The INSERT below re-pins the pending state with WHERE so a concurrent
    // deny / revoke between the SELECT and INSERT is caught.
    const parentRows = await sql<
      Array<{
        id: string;
        workspace_id: string;
        requested_action: string;
        status: string;
      }>
    >`
      SELECT id, workspace_id, requested_action, status
      FROM approval_requests
      WHERE id = ${opts.approvalRequestId}
    `;

    if (parentRows.length === 0) {
      throw new InputInvalidError(
        "issueToken: approvalRequestId not found.",
      );
    }
    const parent = parentRows[0];
    if (parent.status !== "pending") {
      throw new SecureCoreError(
        "APPROVAL_TOKEN_INVALID",
        `issueToken: approval request is ${parent.status}, not pending.`,
      );
    }

    const tokenContextHashHex = this.computeContextHash({
      approvalRequestId: parent.id,
      workspaceId: parent.workspace_id,
      requestedAction: parent.requested_action,
      approverUserId: opts.approverUserId,
      approverRoleId: opts.approverRoleId,
      expiresAt: expiresAt.toISOString(),
    });

    // Conditional INSERT: only land the row if the parent is still
    // pending at insert time. Catches a concurrent deny/revoke that
    // happened between our SELECT and INSERT.
    const insertRows = await sql<ApprovalTokenRow[]>`
      INSERT INTO approval_tokens
        (id, workspace_id, approval_request_id, token_hash,
         token_context_hash, approver_user_id, approver_role_id,
         created_by, expires_at)
      SELECT
        ${id}, ${parent.workspace_id}, ${parent.id}, ${tokenHashHex},
        ${tokenContextHashHex}, ${opts.approverUserId},
        ${opts.approverRoleId}, ${opts.createdBy}, ${expiresAt}
      WHERE EXISTS (
        SELECT 1 FROM approval_requests
        WHERE id = ${parent.id} AND status = 'pending'
      )
      RETURNING id, workspace_id, approval_request_id, token_hash,
                token_context_hash, approver_user_id, approver_role_id,
                created_by, created_at, expires_at, used_at, revoked_at
    `;
    if (insertRows.length === 0) {
      throw new SecureCoreError(
        "APPROVAL_TOKEN_INVALID",
        "issueToken: parent approval request is no longer pending.",
      );
    }

    return { rawToken, tokenRow: insertRows[0] };
  }

  // -------------------------------------------------------------------------
  // consumeToken
  // -------------------------------------------------------------------------

  /**
   * Consume a presented approval token per v4 §16.4.
   *
   * Order:
   *   1. Hash presented token; SELECT the row by hash.
   *   2. Constant-time confirm hash equality (defense in depth).
   *   3. Recompute `token_context_hash` from CURRENT request + token row
   *      values. Mismatch fails closed and emits
   *      `approval.token_context_mismatch`.
   *   4. Verify {expectedRequestId, expectedAction} match (no
   *      cross-action consumption).
   *   5. Verify approver constraint: user-bound → consumer is the bound
   *      user; role-bound → consumer holds the role IN the request's
   *      workspace, with `removed_at IS NULL`.
   *   6. Run the §16.4 atomic UPDATE. 0 rows affected → discriminate
   *      reused / expired / revoked / parent-not-pending and throw the
   *      corresponding error code.
   *
   * Every failure emits its audit row BEFORE the throw.
   */
  public async consumeToken(
    opts: ConsumeTokenOptions,
  ): Promise<{ requestRow: ApprovalRequestRow; tokenRow: ApprovalTokenRow }> {
    const sql = this.pool.sql;
    const presentedHash = hashToken(opts.presentedToken);

    // (1) lookup-by-hash join with the parent request — no UPDATE yet.
    const lookupRows = await sql<
      Array<{
        token_id: string;
        token_workspace_id: string;
        token_request_id: string;
        token_hash: string;
        token_context_hash: string;
        approver_user_id: string | null;
        approver_role_id: string | null;
        token_created_by: string;
        token_created_at: Date;
        token_expires_at: Date;
        token_used_at: Date | null;
        token_revoked_at: Date | null;
        request_id: string;
        request_workspace_id: string;
        request_object_type: string;
        request_object_id: string;
        request_requested_action: string;
        request_requested_by: string;
        request_requested_by_agent: boolean;
        request_status: string;
        request_decided_by: string | null;
        request_decided_at: Date | null;
        request_created_at: Date;
      }>
    >`
      SELECT
        t.id                    AS token_id,
        t.workspace_id          AS token_workspace_id,
        t.approval_request_id   AS token_request_id,
        t.token_hash            AS token_hash,
        t.token_context_hash    AS token_context_hash,
        t.approver_user_id      AS approver_user_id,
        t.approver_role_id      AS approver_role_id,
        t.created_by            AS token_created_by,
        t.created_at            AS token_created_at,
        t.expires_at            AS token_expires_at,
        t.used_at               AS token_used_at,
        t.revoked_at            AS token_revoked_at,
        r.id                    AS request_id,
        r.workspace_id          AS request_workspace_id,
        r.object_type           AS request_object_type,
        r.object_id             AS request_object_id,
        r.requested_action      AS request_requested_action,
        r.requested_by          AS request_requested_by,
        r.requested_by_agent    AS request_requested_by_agent,
        r.status                AS request_status,
        r.decided_by            AS request_decided_by,
        r.decided_at            AS request_decided_at,
        r.created_at            AS request_created_at
      FROM approval_tokens t
      JOIN approval_requests r ON r.id = t.approval_request_id
      WHERE t.token_hash = ${presentedHash}
    `;

    if (lookupRows.length === 0) {
      await this.emitDenied({
        workspaceId: null,
        consumerUserId: opts.consumerUserId,
        requestId: opts.requestId,
        deniedReason: "not_found",
      });
      throw new ApprovalTokenInvalidError(
        "Approval token not found.",
      );
    }

    const row = lookupRows[0];

    // (2) constant-time confirm even though SQL match is constant w.r.t.
    // the presented hash. Defense in depth against a future code path
    // that does a non-hashed comparison.
    if (!compareTokenConstantTime(opts.presentedToken, row.token_hash)) {
      await this.emitDenied({
        workspaceId: row.token_workspace_id,
        consumerUserId: opts.consumerUserId,
        requestId: opts.requestId,
        deniedReason: "hash_mismatch",
      });
      throw new ApprovalTokenInvalidError(
        "Approval token failed integrity check.",
      );
    }

    // (3) recompute context hash from CURRENT row values. Test #9 mutates
    // requested_action server-side after issuance; we MUST notice.
    const recomputedContextHex = this.computeContextHash({
      approvalRequestId: row.request_id,
      workspaceId: row.request_workspace_id,
      requestedAction: row.request_requested_action,
      approverUserId: row.approver_user_id,
      approverRoleId: row.approver_role_id,
      expiresAt: row.token_expires_at.toISOString(),
    });

    if (!hmacBufferEqual(recomputedContextHex, row.token_context_hash)) {
      await this.auditLogger.write({
        workspaceId: row.token_workspace_id,
        actorUserId: opts.consumerUserId,
        actorType: "human",
        action: "approval.token_context_mismatch",
        objectType: "approval_token",
        objectId: row.token_id,
        result: "denied",
        requestId: opts.requestId,
      });
      throw new SecureCoreError(
        "APPROVAL_CONTEXT_MISMATCH",
        "Approval token context hash mismatch.",
      );
    }

    // (4) cross-action consumption guard.
    if (
      row.request_id !== opts.expectedRequestId ||
      row.request_requested_action !== opts.expectedAction
    ) {
      await this.emitDenied({
        workspaceId: row.token_workspace_id,
        consumerUserId: opts.consumerUserId,
        requestId: opts.requestId,
        deniedReason: "wrong_request_or_action",
      });
      throw new ApprovalTokenInvalidError(
        "Approval token does not match expected request or action.",
      );
    }

    // (5) approver constraint.
    if (row.approver_user_id !== null) {
      // User-bound.
      if (row.approver_user_id !== opts.consumerUserId) {
        await this.emitDenied({
          workspaceId: row.token_workspace_id,
          consumerUserId: opts.consumerUserId,
          requestId: opts.requestId,
          deniedReason: "wrong_consumer",
        });
        throw new ApprovalTokenInvalidError(
          "Approval token is bound to a different approver.",
        );
      }
    } else if (row.approver_role_id !== null) {
      // Role-bound: consumer must hold the role AND be an active member
      // of the request's workspace under that role (§16.2.4 #2-#4).
      if (!opts.consumerRoleIds.includes(row.approver_role_id)) {
        await this.emitDenied({
          workspaceId: row.token_workspace_id,
          consumerUserId: opts.consumerUserId,
          requestId: opts.requestId,
          deniedReason: "missing_role",
        });
        throw new ApprovalTokenInvalidError(
          "Approval token requires a role the consumer does not hold.",
        );
      }
      const memberRows = await sql<{ id: string }[]>`
        SELECT id FROM workspace_memberships
        WHERE workspace_id = ${row.request_workspace_id}
          AND user_id = ${opts.consumerUserId}
          AND role_id = ${row.approver_role_id}
          AND removed_at IS NULL
      `;
      if (memberRows.length === 0) {
        await this.emitDenied({
          workspaceId: row.token_workspace_id,
          consumerUserId: opts.consumerUserId,
          requestId: opts.requestId,
          deniedReason: "role_not_in_workspace",
        });
        throw new ApprovalTokenInvalidError(
          "Approval token requires the role be active in the request workspace.",
        );
      }
    } else {
      // Should be unreachable — DB CHECK requires one of the two non-null.
      await this.emitDenied({
        workspaceId: row.token_workspace_id,
        consumerUserId: opts.consumerUserId,
        requestId: opts.requestId,
        deniedReason: "approver_constraint_missing",
      });
      throw new ApprovalTokenInvalidError(
        "Approval token has no approver constraint.",
      );
    }

    // (6) §16.4 atomic UPDATE — the DB is the gate.
    const updateRows = await sql<{ used_at: Date }[]>`
      UPDATE approval_tokens t
      SET used_at = now()
      FROM approval_requests r
      WHERE t.id = ${row.token_id}
        AND t.approval_request_id = r.id
        AND t.used_at IS NULL
        AND t.revoked_at IS NULL
        AND t.expires_at > now()
        AND r.status = 'pending'
      RETURNING t.used_at AS used_at
    `;

    if (updateRows.length === 0) {
      // Discriminate the failure mode by re-reading the row.
      const postRows = await sql<
        Array<{
          used_at: Date | null;
          revoked_at: Date | null;
          expires_at: Date;
          parent_status: string;
        }>
      >`
        SELECT t.used_at, t.revoked_at, t.expires_at,
               r.status AS parent_status
        FROM approval_tokens t
        JOIN approval_requests r ON r.id = t.approval_request_id
        WHERE t.id = ${row.token_id}
      `;
      const post = postRows[0];
      const nowMs = this.now();

      let code: "APPROVAL_TOKEN_REUSED" | "APPROVAL_TOKEN_INVALID";
      let message: string;
      let deniedReason: string;
      if (post && post.used_at !== null) {
        code = "APPROVAL_TOKEN_REUSED";
        message = "Approval token has already been consumed.";
        deniedReason = "already_used";
      } else if (post && post.revoked_at !== null) {
        code = "APPROVAL_TOKEN_INVALID";
        message = "Approval token has been revoked.";
        deniedReason = "revoked";
      } else if (post && post.expires_at.getTime() <= nowMs) {
        code = "APPROVAL_TOKEN_INVALID";
        message = "Approval token has expired.";
        deniedReason = "expired";
      } else if (post && post.parent_status !== "pending") {
        code = "APPROVAL_TOKEN_INVALID";
        message = `Approval request is ${post.parent_status}, not pending.`;
        deniedReason = `parent_${post.parent_status}`;
      } else {
        code = "APPROVAL_TOKEN_INVALID";
        message = "Approval token consumption failed.";
        deniedReason = "atomic_update_zero_rows";
      }

      await this.emitDenied({
        workspaceId: row.token_workspace_id,
        consumerUserId: opts.consumerUserId,
        requestId: opts.requestId,
        deniedReason,
      });
      throw new SecureCoreError(code, message);
    }

    // Success.
    const usedAt = updateRows[0].used_at;
    const tokenRow: ApprovalTokenRow = {
      id: row.token_id,
      workspace_id: row.token_workspace_id,
      approval_request_id: row.token_request_id,
      token_hash: row.token_hash,
      token_context_hash: row.token_context_hash,
      approver_user_id: row.approver_user_id,
      approver_role_id: row.approver_role_id,
      created_by: row.token_created_by,
      created_at: row.token_created_at,
      expires_at: row.token_expires_at,
      used_at: usedAt,
      revoked_at: row.token_revoked_at,
    };
    const requestRow: ApprovalRequestRow = {
      id: row.request_id,
      workspace_id: row.request_workspace_id,
      object_type: row.request_object_type,
      object_id: row.request_object_id,
      requested_action: row.request_requested_action,
      requested_by: row.request_requested_by,
      requested_by_agent: row.request_requested_by_agent,
      status: row.request_status,
      decided_by: row.request_decided_by,
      decided_at: row.request_decided_at,
      created_at: row.request_created_at,
    };

    await this.auditLogger.write({
      workspaceId: row.token_workspace_id,
      actorUserId: opts.consumerUserId,
      actorType: "human",
      action: "approval.granted",
      objectType: "approval_token",
      objectId: row.token_id,
      result: "succeeded",
      requestId: opts.requestId,
    });

    return { requestRow, tokenRow };
  }

  // -------------------------------------------------------------------------
  // denyRequest / revokeRequest
  // -------------------------------------------------------------------------

  /**
   * Deny a pending request and revoke every outstanding token for it.
   * Per v4 §16.4: denial sets `revoked_at`, NOT `used_at`, on tokens so
   * a concurrent consume sees `revoked_at IS NOT NULL` and refuses.
   */
  public async denyRequest(
    opts: DecideRequestOptions,
  ): Promise<ApprovalRequestRow> {
    return this.decide(opts, "denied", "approval.denied");
  }

  /**
   * Revoke a request and its outstanding tokens. Same mechanism as
   * `denyRequest`; the lifecycle distinction is human/intent-level.
   */
  public async revokeRequest(
    opts: DecideRequestOptions,
  ): Promise<ApprovalRequestRow> {
    return this.decide(opts, "revoked", "approval.revoked");
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  private async decide(
    opts: DecideRequestOptions,
    targetStatus: "denied" | "revoked",
    auditAction: "approval.denied" | "approval.revoked",
  ): Promise<ApprovalRequestRow> {
    const sql = this.pool.sql;

    // Conditional update: only flip from pending. Idempotent re-deny is a
    // bug — the caller should treat a non-pending row as a 409.
    const reqRows = await sql<ApprovalRequestRow[]>`
      UPDATE approval_requests
      SET status = ${targetStatus},
          decided_by = ${opts.decidedBy},
          decided_at = now()
      WHERE id = ${opts.approvalRequestId}
        AND status = 'pending'
      RETURNING id, workspace_id, object_type, object_id,
                requested_action, requested_by, requested_by_agent,
                status, decided_by, decided_at, created_at
    `;
    if (reqRows.length === 0) {
      throw new SecureCoreError(
        "APPROVAL_TOKEN_INVALID",
        `Approval request is not pending; cannot ${targetStatus === "denied" ? "deny" : "revoke"}.`,
      );
    }
    const reqRow = reqRows[0];

    // Revoke outstanding tokens for this request. Per §16.4, denial AND
    // revocation set revoked_at on tokens (NOT used_at) so a concurrent
    // consumeToken sees revoked_at IS NOT NULL and refuses.
    await sql`
      UPDATE approval_tokens
      SET revoked_at = now()
      WHERE approval_request_id = ${reqRow.id}
        AND used_at IS NULL
        AND revoked_at IS NULL
    `;

    await this.auditLogger.write({
      workspaceId: reqRow.workspace_id,
      actorUserId: opts.decidedBy,
      actorType: "human",
      action: auditAction,
      objectType: "approval_request",
      objectId: reqRow.id,
      result: targetStatus === "denied" ? "denied" : "succeeded",
      requestId: opts.requestId,
    });

    return reqRow;
  }

  /**
   * §16.3 token_context_hash. The canonical-input shape is fixed —
   * adding a field is a forward-only migration that requires re-issuing
   * outstanding tokens (their old hash will no longer match).
   */
  private computeContextHash(args: {
    approvalRequestId: string;
    workspaceId: string;
    requestedAction: string;
    approverUserId: string | null;
    approverRoleId: string | null;
    expiresAt: string;
  }): string {
    const approverConstraint: Record<string, string> =
      args.approverUserId !== null
        ? { approver_user_id: args.approverUserId }
        : args.approverRoleId !== null
          ? {
              workspace_id: args.workspaceId,
              approver_role_id: args.approverRoleId,
            }
          : {};
    const canonical = canonicalize({
      approval_request_id: args.approvalRequestId,
      workspace_id: args.workspaceId,
      requested_action: args.requestedAction,
      approver_constraint: approverConstraint,
      expires_at: args.expiresAt,
    });
    return hmacSha256(this.approvalHmacKey, canonical);
  }

  private async emitDenied(args: {
    workspaceId: string | null;
    consumerUserId: string;
    requestId: string;
    deniedReason: string;
  }): Promise<void> {
    await this.auditLogger.write({
      workspaceId: args.workspaceId,
      actorUserId: args.consumerUserId,
      actorType: "human",
      action: "approval.denied",
      objectType: "approval_token",
      result: "denied",
      requestId: args.requestId,
      metadata: { denied_reason: args.deniedReason },
    });
  }
}

// Re-export the upstream errors so callers can `import { ... } from
// "@simworkbench/secure-core/approvals"` without reaching into errors/.
export {
  ApprovalRequiredError,
  ApprovalTokenInvalidError,
  SecureCoreError,
} from "../errors/shapes.js";

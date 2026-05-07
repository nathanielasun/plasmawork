/**
 * Operator routes — Phase 0.5 Layer 4 task L4.10.
 *
 * Top-level (NOT workspace-scoped) endpoints per v4 §22.2 Operator
 * Access:
 *
 *   GET  /operator/audit-events?workspace_id=…
 *   POST /operator/incident/:workspaceId/investigate
 *   POST /operator/incident/:workspaceId/remediate
 *
 * Operator capabilities live OUTSIDE the workspace-membership model
 * (v4 §13.2). The middleware chain therefore SKIPS `loadWorkspace`,
 * `enforceUniformNotFound`, and `requireWorkspaceMembership` — by
 * design. Operator capability lookup is injected via
 * `OperatorRoutesMiddleware.requireOperatorCapability_*`; each is
 * pre-bound to ONE platform capability (`platform:audit_read`,
 * `platform:incident_investigate`, `platform:incident_remediate`).
 *
 * Routes NEVER read actor identity from `req.body` (v4 §4.1, §19.1).
 * The `actor_user_id` written into the operator + audit rows comes
 * straight from `req.auth.userId` populated by `requireAuth`. Likewise
 * `actor_type` is materialized as `"operator"` inside `OperatorService`,
 * not read from any request shape.
 *
 * The /investigate and /remediate endpoints are bound to L2.9
 * `requireApprovalIfHighRisk` with action `platform_operator_access`.
 * Per v4 §16.1 the approval TOKEN MUST come via the `X-Approval-Token`
 * header (never URL/body). The approval REQUEST id lives in the body
 * because the operator URL signature has no native slot for it; the
 * audit-aware body validator copies it into
 * `req.params.approvalRequestId` so L2.9 can use its standard lookup.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
} from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import {
  InputInvalidError,
  NotFoundError,
  PermissionDeniedError,
  SecureCoreError,
} from "../errors/shapes.js";
import type {
  KeysetCursor,
} from "../audit/readService.js";
import type {
  OperatorService,
  RemediationAction,
} from "../operator/service.js";
import type { AuditLogger } from "../audit/logger.js";
import { bodyValidationWithApprovalRequest } from "./validation.js";

/** UUID v4 regex — used by URL-param + body probes. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TTL_SECONDS = 8 * 60 * 60; // v4 §22.2 default cap.
const MAX_REASON_LENGTH = 4096;

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new NotFoundError(`Not found.`, { param: label });
  }
  return value;
}

function decodeCursor(raw: string): KeysetCursor {
  let json: string;
  try {
    json = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new InputInvalidError("Cursor decode failed.", {
      field: "cursor",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InputInvalidError("Cursor JSON parse failed.", {
      field: "cursor",
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InputInvalidError("Cursor must be an object.", {
      field: "cursor",
    });
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.created_at !== "string" || typeof obj.id !== "string") {
    throw new InputInvalidError("Cursor missing required fields.", {
      field: "cursor",
    });
  }
  if (!UUID_V4.test(obj.id)) {
    throw new InputInvalidError("Cursor id is not a UUID.", {
      field: "cursor",
    });
  }
  const date = new Date(obj.created_at);
  if (Number.isNaN(date.getTime())) {
    throw new InputInvalidError("Cursor created_at is not a valid date.", {
      field: "cursor",
    });
  }
  return { createdAt: date, id: obj.id };
}

function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(
    JSON.stringify({
      created_at: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64");
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new InputInvalidError("limit must be a positive integer.", {
      field: "limit",
    });
  }
  if (n > MAX_LIMIT) {
    throw new InputInvalidError(`limit must be <= ${MAX_LIMIT}.`, {
      field: "limit",
    });
  }
  return n;
}

const AUDIT_EVENTS_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^[0-9]{1,4}$" },
    cursor: { type: "string", minLength: 1, maxLength: 4096 },
    workspace_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

const INVESTIGATE_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "ttl_seconds", "approval_request_id"],
  properties: {
    reason: { type: "string", minLength: 1, maxLength: MAX_REASON_LENGTH },
    ttl_seconds: { type: "integer", minimum: 60, maximum: MAX_TTL_SECONDS },
    approval_request_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

const REMEDIATE_ACTIONS = [
  "delete_session",
  "revoke_membership",
  "lock_capsule",
] as const;

const REMEDIATE_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "action", "target_id", "approval_request_id"],
  properties: {
    reason: { type: "string", minLength: 1, maxLength: MAX_REASON_LENGTH },
    action: { type: "string", enum: REMEDIATE_ACTIONS },
    target_id: { type: "string", pattern: UUID_V4.source },
    approval_request_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

interface AuditEventsQuery {
  limit?: string;
  cursor?: string;
  workspace_id?: string;
}

interface InvestigateBody {
  reason: string;
  ttl_seconds: number;
  approval_request_id: string;
}

interface RemediateBody {
  reason: string;
  action: RemediationAction;
  target_id: string;
  approval_request_id: string;
}

export interface OperatorRoutesMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  /** Pre-bound to `platform:audit_read`. */
  readonly requireOperatorAuditRead: NamedMiddleware;
  /** Pre-bound to `platform:incident_investigate`. */
  readonly requireOperatorIncidentInvestigate: NamedMiddleware;
  /** Pre-bound to `platform:incident_remediate`. */
  readonly requireOperatorIncidentRemediate: NamedMiddleware;
  /**
   * L2.9 factory. Plugin calls it with action
   * `platform_operator_access` to produce the action-bound
   * `requireApprovalIfHighRisk` middleware for /remediate. The factory
   * is referenced (not pre-built) so test code can record the action it
   * was bound with — same pattern as L4.6.
   */
  readonly requireApprovalIfHighRiskFactory: () => NamedMiddleware;
}

export interface OperatorRoutesOptions {
  readonly service: OperatorService;
  readonly auditLogger: AuditLogger;
  readonly mw: OperatorRoutesMiddleware;
}

function assertOperatorStepUp(req: {
  auth?: { assuranceLevel: "aal1" | "aal2" | "aal3" };
}): void {
  if (req.auth?.assuranceLevel !== "aal2" && req.auth?.assuranceLevel !== "aal3") {
    throw new PermissionDeniedError(
      "Operator access requires step-up authentication.",
      { reason: "step_up_required" },
    );
  }
}

export const operatorRoutes: FastifyPluginAsync<OperatorRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service, mw } = opts;
  const validateInvestigate = bodyValidationWithApprovalRequest(
    INVESTIGATE_BODY_SCHEMA,
    opts.auditLogger,
  );
  const validateRemediate = bodyValidationWithApprovalRequest(
    REMEDIATE_BODY_SCHEMA,
    opts.auditLogger,
  );
  const approvalIfHighRisk = mw.requireApprovalIfHighRiskFactory();

  // -------------------------------------------------------------------
  // GET /operator/audit-events  — cross-workspace audit read
  // -------------------------------------------------------------------
  app.get<{ Querystring: AuditEventsQuery }>(
    "/operator/audit-events",
    {
      schema: { querystring: AUDIT_EVENTS_QUERY_SCHEMA },
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.requireOperatorAuditRead,
      ]),
    },
    async (req) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertOperatorStepUp(req);
      const limit = parseLimit(req.query.limit);
      const cursor =
        req.query.cursor !== undefined
          ? decodeCursor(req.query.cursor)
          : undefined;
      const workspaceFilter = req.query.workspace_id;
      const result = await service.listAuditEventsCrossWorkspace({
        actorUserId: req.auth.userId,
        sessionId: req.auth.sessionId,
        requestId: req.requestId,
        workspaceId: workspaceFilter,
        limit,
        cursor,
      });
      const body: {
        events: typeof result.rows;
        next_cursor?: string;
      } = { events: result.rows };
      if (result.nextCursor !== null) {
        body.next_cursor = encodeCursor(result.nextCursor);
      }
      return body;
    },
  );

  // -------------------------------------------------------------------
  // POST /operator/incident/:workspaceId/investigate
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string };
    Body: InvestigateBody;
  }>(
    "/operator/incident/:workspaceId/investigate",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateInvestigate,
        mw.attachAuditActor,
        mw.requireOperatorIncidentInvestigate,
        approvalIfHighRisk,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertOperatorStepUp(req);
      const workspaceId = assertUuid(req.params.workspaceId, "workspaceId");
      const result = await service.enterInvestigation({
        actorUserId: req.auth.userId,
        sessionId: req.auth.sessionId,
        requestId: req.requestId,
        targetWorkspaceId: workspaceId,
        reason: req.body.reason,
        ttlSeconds: req.body.ttl_seconds,
      });
      return reply.code(201).send({
        session_id: result.sessionId,
        expires_at: result.expiresAt,
      });
    },
  );

  // -------------------------------------------------------------------
  // POST /operator/incident/:workspaceId/remediate
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string };
    Body: RemediateBody;
  }>(
    "/operator/incident/:workspaceId/remediate",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateRemediate,
        mw.attachAuditActor,
        mw.requireOperatorIncidentRemediate,
        approvalIfHighRisk,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertOperatorStepUp(req);
      const workspaceId = assertUuid(req.params.workspaceId, "workspaceId");
      const result = await service.executeRemediation({
        actorUserId: req.auth.userId,
        sessionId: req.auth.sessionId,
        requestId: req.requestId,
        targetWorkspaceId: workspaceId,
        reason: req.body.reason,
        action: req.body.action,
        targetId: req.body.target_id,
      });
      return reply.code(200).send({
        action: result.action,
        target_id: result.targetId,
        audit_event_id: result.auditEventId,
        operator_event_id: result.operatorEventId,
      });
    },
  );
};

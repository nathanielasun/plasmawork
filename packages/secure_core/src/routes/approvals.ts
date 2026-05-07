/**
 * Approval-request routes — Phase 0.5 Layer 4 task L4.6.
 *
 * v4 §10.2 endpoints:
 *
 *   POST /workspaces/:workspaceId/approval-requests
 *   POST /workspaces/:workspaceId/approval-requests/:approvalRequestId/approve
 *   POST /workspaces/:workspaceId/approval-requests/:approvalRequestId/deny
 *
 * Every state-changing endpoint runs through the §6.2 middleware
 * chain via `composeMiddleware()`. The chain composition is left to
 * the registering app (it injects the L2 deps); this module exports
 * a plugin factory that takes the middleware bundle + service
 * already constructed.
 *
 * Action binding (L4.6 deviation, see commit message):
 *   The L2.9 `requireApprovalIfHighRisk` middleware verifies the
 *   `expectedAction` at consumption time. The action is fixed at
 *   route registration. Because v4 §10.2 specifies one canonical
 *   `/approve` URL but L2.9 is action-bound, this plugin accepts
 *   `action: HighRiskAction` via `ApprovalRoutesOptions`. The host
 *   wires the corresponding `requireApprovalDecideCapability` for
 *   the same action; both are bound together at registration.
 *
 * The /approval-requests CREATE handler is independent of `opts.action`
 * — it accepts the `requested_action` going INTO the new approval_requests
 * row from the body, after the route's `requireApprovalRequestCapability`
 * mw confirms the caller holds `approval:request`. The action-creation
 * audit row is emitted by `ApprovalService.requestApproval`.
 *
 * The route plugin never:
 *   - emits audit itself (the service is the only audit producer)
 *   - reads `actor` / `actor_user_id` / `created_by` / `requested_by`
 *     from `req.body` (v4 §4.1, §19.1 hard rule)
 *   - exposes a token-bypass flag of any shape
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import type { ApprovalService } from "../approvals/service.js";
import type { AuditLogger } from "../audit/logger.js";
import {
  HIGH_RISK_ACTIONS,
  type HighRiskAction,
} from "../config/high_risk_actions.js";
import { bodyValidation } from "./validation.js";
import { NotFoundError, SecureCoreError } from "../errors/shapes.js";

/** UUID v4 regex — used by URL-param probes. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new NotFoundError(`Not found.`, { param: label });
  }
  return value;
}

/**
 * Middleware bundle the host composes into route preHandlers. Each
 * pre-bound `NamedMiddleware` is the already-constructed L2 layer
 * (e.g. `requireAuth(deps)`). The factory is called inside the plugin
 * with the `opts.action` — see the action-binding note above.
 */
export interface ApprovalRoutesMiddleware {
  readonly enforceApprovalRequestRateLimit?: NamedMiddleware;
  readonly enforceApprovalConsumeRateLimit?: NamedMiddleware;
  readonly enforceApprovalDenyRateLimit?: NamedMiddleware;
  readonly requireAuth: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  readonly loadWorkspace: NamedMiddleware;
  readonly enforceUniformNotFound: NamedMiddleware;
  readonly requireWorkspaceMembership: NamedMiddleware;
  /** `approval:request` capability-bound mw — gates POST /approval-requests. */
  readonly requireApprovalRequestCapability: NamedMiddleware;
  /**
   * Capability-bound mw for /deny. Varies per action; the host binds
   * it at registration to `HIGH_RISK_APPROVER_CAPABILITY[opts.action]`.
   */
  readonly requireApprovalDecideCapability: NamedMiddleware;
  /**
   * L2.9 factory — the plugin calls it with `opts.action` to produce
   * the action-bound `requireApprovalIfHighRisk` middleware for the
   * /approve route. The factory itself is referenced (not pre-built)
   * so test code can record the action it was bound with.
   */
  readonly requireApprovalIfHighRiskFactory: (
    action: HighRiskAction,
  ) => NamedMiddleware;
}

export interface ApprovalRoutesOptions {
  readonly service: ApprovalService;
  readonly auditLogger: AuditLogger;
  readonly mw: ApprovalRoutesMiddleware;
  /**
   * The high-risk action this plugin instance handles. Fixed at
   * registration; the host registers this plugin once per action
   * (or once globally if Layer-5 introduces a per-row action lookup).
   * The L4.6 deviation note in the file header explains the choice.
   */
  readonly action: HighRiskAction;
}

// ---------------------------------------------------------------------
// Body schemas — Ajv + additionalProperties: false (v4 §4.1).
// ---------------------------------------------------------------------

interface CreateApprovalRequestBody {
  object_type: string;
  object_id: string;
  requested_action: string;
}

interface DenyApprovalRequestBody {
  reason?: string;
}

const CREATE_APPROVAL_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["object_type", "object_id", "requested_action"],
  properties: {
    object_type: { type: "string", minLength: 1, maxLength: 100 },
    object_id: { type: "string", minLength: 1, maxLength: 200 },
    requested_action: {
      type: "string",
      enum: HIGH_RISK_ACTIONS as unknown as string[],
    },
  },
} as const;

/** /approve body is empty — token comes from the X-Approval-Token header. */
const APPROVE_APPROVAL_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

const DENY_APPROVAL_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reason: { type: "string", minLength: 1, maxLength: 1000 },
  },
} as const;

export const approvalRoutes: FastifyPluginAsync<ApprovalRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service, mw, action } = opts;
  const validateCreateApprovalRequest = bodyValidation(
    CREATE_APPROVAL_REQUEST_SCHEMA,
    opts.auditLogger,
  );
  const validateApproveApprovalRequest = bodyValidation(
    APPROVE_APPROVAL_REQUEST_SCHEMA,
    opts.auditLogger,
  );
  const validateDenyApprovalRequest = bodyValidation(
    DENY_APPROVAL_REQUEST_SCHEMA,
    opts.auditLogger,
  );
  const createPreHandler = mw.enforceApprovalRequestRateLimit === undefined
    ? composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateCreateApprovalRequest,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireApprovalRequestCapability,
      ])
    : composeMiddleware([
        mw.enforceApprovalRequestRateLimit,
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateCreateApprovalRequest,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireApprovalRequestCapability,
      ]);

  // L2.9 is action-bound at registration. The factory is called once
  // here, the produced NamedMiddleware is then composed with the §6.2
  // chain like any other middleware.
  const approvalIfHighRisk = mw.requireApprovalIfHighRiskFactory(action);
  const approvePreHandler = mw.enforceApprovalConsumeRateLimit === undefined
    ? composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateApproveApprovalRequest,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        approvalIfHighRisk,
      ])
    : composeMiddleware([
        mw.enforceApprovalConsumeRateLimit,
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateApproveApprovalRequest,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        approvalIfHighRisk,
      ]);
  const denyPreHandler = mw.enforceApprovalDenyRateLimit === undefined
    ? composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateDenyApprovalRequest,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireApprovalDecideCapability,
      ])
    : composeMiddleware([
        mw.enforceApprovalDenyRateLimit,
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateDenyApprovalRequest,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireApprovalDecideCapability,
      ]);

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/approval-requests
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string };
    Body: CreateApprovalRequestBody;
  }>(
    "/workspaces/:workspaceId/approval-requests",
    {
      preHandler: createPreHandler,
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      const row = await service.requestApproval({
        workspaceId: req.params.workspaceId,
        objectType: req.body.object_type,
        objectId: req.body.object_id,
        requestedAction: req.body.requested_action,
        requestedBy: req.auth.userId,
        requestedByAgent: req.auth.actorType === "ai_agent",
        requestId: req.requestId,
      });
      return reply.code(201).send({ approval_request: row });
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/approval-requests/:approvalRequestId/approve
  //   — gated by L2.9 requireApprovalIfHighRisk; the middleware reads
  //   X-Approval-Token, calls ApprovalService.consumeToken, and the
  //   service handles the §16.4 atomic transition + audit emission.
  //   The route handler runs only if the middleware succeeded; the
  //   consumed approval-request row is attached at req.approvalToken.
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string; approvalRequestId: string };
    Body: Record<string, never>;
  }>(
    "/workspaces/:workspaceId/approval-requests/:approvalRequestId/approve",
    {
      preHandler: approvePreHandler,
    },
    async (req, reply) => {
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.approvalRequestId, "approvalRequestId");
      const consumed = (
        req as typeof req & {
          approvalToken?: {
            requestRow: { id: string; status: string };
          };
        }
      ).approvalToken;
      if (consumed === undefined) {
        // L2.9 must have populated this on success; defensive guard.
        throw new SecureCoreError(
          "INTERNAL_ERROR",
          "approve handler reached without an approvalToken context.",
        );
      }
      return reply.code(200).send({
        approval_request: {
          id: consumed.requestRow.id,
          status: consumed.requestRow.status,
        },
      });
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/approval-requests/:approvalRequestId/deny
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string; approvalRequestId: string };
    Body: DenyApprovalRequestBody;
  }>(
    "/workspaces/:workspaceId/approval-requests/:approvalRequestId/deny",
    {
      preHandler: denyPreHandler,
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.approvalRequestId, "approvalRequestId");
      // The service handles the workspace-scope check, status transition,
      // outstanding-token revocation, and audit emission.
      const row = await service.denyRequest({
        approvalRequestId: req.params.approvalRequestId,
        decidedBy: req.auth.userId,
        requestId: req.requestId,
      });
      return reply.code(200).send({ approval_request: row });
    },
  );
};

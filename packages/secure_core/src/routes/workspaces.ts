/**
 * Workspace + member routes — Phase 0.5 Layer 4 task L4.1.
 *
 * v4 §10.2 endpoints:
 *
 *   GET    /workspaces
 *   POST   /workspaces
 *   GET    /workspaces/:workspaceId/members
 *   POST   /workspaces/:workspaceId/members
 *   PATCH  /workspaces/:workspaceId/members/:userId
 *   DELETE /workspaces/:workspaceId/members/:userId
 *
 * Every state-changing endpoint runs through the §6.2 middleware
 * chain via `composeMiddleware()`. The chain composition is left to
 * the registering app (it injects the L2 deps); this module exports
 * a plugin factory that takes the middleware factories + service
 * already constructed.
 *
 * Read endpoints skip CSRF (idempotent) and `requireApprovalIfHighRisk`
 * (no high-risk action). Write endpoints include the full chain.
 *
 * The /workspaces top-level routes (list / create) skip the
 * workspace-scoping middleware (`loadWorkspace`,
 * `enforceUniformNotFound`, `requireWorkspaceMembership`,
 * `requireCapability`) because the URL has no workspaceId — auth
 * is the only gate. POST /workspaces creates a fresh workspace
 * with the caller as the WorkspaceAdmin; no upstream membership is
 * required (v4 §10.2 doesn't require the caller to already be in a
 * workspace to create one).
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
} from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import type { WorkspaceService } from "../workspaces/service.js";
import { SecureCoreError, NotFoundError } from "../errors/shapes.js";
import type { AuditLogger } from "../audit/logger.js";
import type { HighRiskAction } from "../config/high_risk_actions.js";
import {
  bodyValidation,
  bodyValidationWithApprovalRequest,
} from "./validation.js";

/**
 * Middleware factories the app composes into route preHandlers. Each
 * is the already-constructed `NamedMiddleware` from the L2 layer
 * (e.g. `requireAuth(deps)`).
 *
 * Routes that need different `requireCapability` calls per endpoint
 * accept those capability-bound mws by name in the per-route
 * options below; the plugin doesn't re-create them.
 */
export interface WorkspaceRoutesMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  readonly loadWorkspace: NamedMiddleware;
  readonly enforceUniformNotFound: NamedMiddleware;
  readonly requireWorkspaceMembership: NamedMiddleware;
  /** `workspace:manage_members` capability-bound mw. */
  readonly requireManageMembers: NamedMiddleware;
  readonly requireApprovalIfHighRiskFactory: (
    action: HighRiskAction,
  ) => NamedMiddleware;
}

export interface WorkspaceRoutesOptions {
  readonly service: WorkspaceService;
  readonly auditLogger: AuditLogger;
  readonly mw: WorkspaceRoutesMiddleware;
}

/** UUID v4 regex — used by the URL-param probes below. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new NotFoundError(`Not found.`, { param: label });
  }
  return value;
}

interface CreateWorkspaceBody {
  name: string;
}
interface AddMemberBody {
  target_user_id: string;
  role_name: string;
  approval_request_id: string;
}
interface ChangeRoleBody {
  role_name: string;
  approval_request_id: string;
}
interface RemoveMemberBody {
  approval_request_id: string;
}

const CREATE_WORKSPACE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

const ADD_MEMBER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["target_user_id", "role_name", "approval_request_id"],
  properties: {
    target_user_id: { type: "string", pattern: UUID_V4.source },
    role_name: { type: "string", minLength: 1, maxLength: 100 },
    approval_request_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

const CHANGE_ROLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["role_name", "approval_request_id"],
  properties: {
    role_name: { type: "string", minLength: 1, maxLength: 100 },
    approval_request_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

const REMOVE_MEMBER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["approval_request_id"],
  properties: {
    approval_request_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

export const workspaceRoutes: FastifyPluginAsync<WorkspaceRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service, mw } = opts;
  const validateCreateWorkspace = bodyValidation(
    CREATE_WORKSPACE_SCHEMA,
    opts.auditLogger,
  );
  const validateAddMember = bodyValidationWithApprovalRequest(
    ADD_MEMBER_SCHEMA,
    opts.auditLogger,
  );
  const validateChangeRole = bodyValidationWithApprovalRequest(
    CHANGE_ROLE_SCHEMA,
    opts.auditLogger,
  );
  const validateRemoveMember = bodyValidationWithApprovalRequest(
    REMOVE_MEMBER_SCHEMA,
    opts.auditLogger,
  );
  const requireMembershipChangeApproval = mw.requireApprovalIfHighRiskFactory(
    "workspace_membership_change",
  );

  // -------------------------------------------------------------------
  // GET /workspaces  — list workspaces the caller is an active member of
  // -------------------------------------------------------------------
  app.get(
    "/workspaces",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
      ]),
    },
    async (req) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      const rows = await service.listForActor(req.auth.userId);
      return { workspaces: rows };
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces  — create + auto-add caller as WorkspaceAdmin
  // -------------------------------------------------------------------
  app.post<{ Body: CreateWorkspaceBody }>(
    "/workspaces",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateCreateWorkspace,
        mw.attachAuditActor,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      const ws = await service.createWorkspace({
        name: req.body.name,
        createdByUserId: req.auth.userId,
        requestId: req.requestId,
      });
      return reply.code(201).send({ workspace: ws });
    },
  );

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/members
  // -------------------------------------------------------------------
  app.get(
    "/workspaces/:workspaceId/members",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
      ]),
    },
    async (req) => {
      const params = req.params as { workspaceId: string };
      assertUuid(params.workspaceId, "workspaceId");
      const rows = await service.listMembers(params.workspaceId);
      return { members: rows };
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/members
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string };
    Body: AddMemberBody;
  }>(
    "/workspaces/:workspaceId/members",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateAddMember,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireManageMembers,
        requireMembershipChangeApproval,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      const row = await service.addMember({
        workspaceId: req.params.workspaceId,
        targetUserId: req.body.target_user_id,
        roleName: req.body.role_name,
        actorUserId: req.auth.userId,
        requestId: req.requestId,
      });
      return reply.code(201).send({ membership: row });
    },
  );

  // -------------------------------------------------------------------
  // PATCH /workspaces/:workspaceId/members/:userId  — change role
  // -------------------------------------------------------------------
  app.patch<{
    Params: { workspaceId: string; userId: string };
    Body: ChangeRoleBody;
  }>(
    "/workspaces/:workspaceId/members/:userId",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateChangeRole,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireManageMembers,
        requireMembershipChangeApproval,
      ]),
    },
    async (req) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.userId, "userId");
      const row = await service.changeMemberRole({
        workspaceId: req.params.workspaceId,
        targetUserId: req.params.userId,
        newRoleName: req.body.role_name,
        actorUserId: req.auth.userId,
        requestId: req.requestId,
      });
      return { membership: row };
    },
  );

  // -------------------------------------------------------------------
  // DELETE /workspaces/:workspaceId/members/:userId
  // -------------------------------------------------------------------
  app.delete<{
    Params: { workspaceId: string; userId: string };
    Body: RemoveMemberBody;
  }>(
    "/workspaces/:workspaceId/members/:userId",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateRemoveMember,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireManageMembers,
        requireMembershipChangeApproval,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.userId, "userId");
      await service.removeMember({
        workspaceId: req.params.workspaceId,
        targetUserId: req.params.userId,
        actorUserId: req.auth.userId,
        requestId: req.requestId,
      });
      return reply.code(204).send();
    },
  );
};

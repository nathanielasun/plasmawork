/**
 * Tool routes — Phase 0.5 Layer 4 task L4.4.
 *
 * v4 §10.2 endpoints:
 *
 *   GET    /workspaces/:workspaceId/tools
 *   POST   /workspaces/:workspaceId/tools
 *   GET    /workspaces/:workspaceId/tools/:toolId
 *   PATCH  /workspaces/:workspaceId/tools/:toolId
 *   POST   /workspaces/:workspaceId/tools/:toolId/promote-request
 *
 * v4 §10.3 — list + read return workspace-owned tools UNION global
 * trusted tools (workspace_id IS NULL AND status = 'trusted'). The
 * carve-out is enforced INSIDE the service (single SQL query that
 * picks either-or) because the L2.7 `enforceObjectWorkspaceScope`
 * middleware doesn't model the global-trusted case.
 *
 * v4 §17 — promote-to-validated/trusted is a high-risk action. The
 * PATCH path REFUSES `status='validated'` and `status='trusted'`
 * with INPUT_INVALID + `{ reason: "use_promote_request" }`. The
 * actual flip is owned by the L4.6 approval-decide endpoint.
 *
 * Read endpoints skip CSRF (idempotent) and `requireApprovalIfHighRisk`.
 * Write endpoints include the full chain. None of these routes
 * require a high-risk approval token at THIS layer — promote-request
 * just creates a pending row; the approval token is consumed at
 * approval-decide time.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import type { ToolService } from "../tools/service.js";
import { SecureCoreError, NotFoundError } from "../errors/shapes.js";

/**
 * The middleware bundle the registering app provides. Each entry is
 * an already-constructed `NamedMiddleware` from L2.
 *
 * Capability-bound middleware are passed by name so the plugin
 * doesn't reach into the L2 layer's deps to construct them.
 */
export interface ToolRoutesMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  readonly loadWorkspace: NamedMiddleware;
  readonly enforceUniformNotFound: NamedMiddleware;
  readonly requireWorkspaceMembership: NamedMiddleware;
  /** `tool:read` capability-bound mw. */
  readonly requireToolRead: NamedMiddleware;
  /** `tool:create` capability-bound mw. */
  readonly requireToolCreate: NamedMiddleware;
  /** `tool:update` capability-bound mw. */
  readonly requireToolUpdate: NamedMiddleware;
  /** `tool:request_promotion` capability-bound mw. */
  readonly requireToolRequestPromotion: NamedMiddleware;
}

export interface ToolRoutesOptions {
  readonly service: ToolService;
  readonly mw: ToolRoutesMiddleware;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new NotFoundError(`Not found.`, { param: label });
  }
  return value;
}

interface CreateToolBody {
  name: string;
  content_hash: string;
  storage_path: string;
}
interface UpdateToolBody {
  name?: string;
  status?: string;
}
interface PromoteRequestBody {
  target_status: "candidate" | "validated" | "trusted";
}

const CREATE_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "content_hash", "storage_path"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    content_hash: { type: "string", minLength: 1, maxLength: 256 },
    storage_path: { type: "string", minLength: 1, maxLength: 1024 },
  },
} as const;

const UPDATE_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    status: {
      type: "string",
      // Schema accepts every CHECK-allowed status; the service
      // refuses validated/trusted with the use_promote_request
      // hint so the error message is actionable. (Refusing here
      // would surface as a generic Ajv error.)
      enum: ["draft", "candidate", "validated", "trusted", "deprecated"],
    },
  },
} as const;

const PROMOTE_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["target_status"],
  properties: {
    target_status: {
      type: "string",
      enum: ["candidate", "validated", "trusted"],
    },
  },
} as const;

export const toolRoutes: FastifyPluginAsync<ToolRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service, mw } = opts;

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/tools
  // -------------------------------------------------------------------
  app.get(
    "/workspaces/:workspaceId/tools",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireToolRead,
      ]),
    },
    async (req) => {
      const params = req.params as { workspaceId: string };
      assertUuid(params.workspaceId, "workspaceId");
      const rows = await service.listForWorkspace(params.workspaceId);
      return { tools: rows };
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/tools
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string };
    Body: CreateToolBody;
  }>(
    "/workspaces/:workspaceId/tools",
    {
      schema: { body: CREATE_TOOL_SCHEMA },
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireToolCreate,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      const row = await service.createTool({
        workspaceId: req.params.workspaceId,
        name: req.body.name,
        contentHash: req.body.content_hash,
        storagePath: req.body.storage_path,
        actorUserId: req.auth.userId,
        requestId: req.requestId,
      });
      return reply.code(201).send({ tool: row });
    },
  );

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/tools/:toolId
  // -------------------------------------------------------------------
  app.get<{ Params: { workspaceId: string; toolId: string } }>(
    "/workspaces/:workspaceId/tools/:toolId",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireToolRead,
      ]),
    },
    async (req) => {
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.toolId, "toolId");
      const row = await service.getTool(
        req.params.workspaceId,
        req.params.toolId,
      );
      return { tool: row };
    },
  );

  // -------------------------------------------------------------------
  // PATCH /workspaces/:workspaceId/tools/:toolId
  // -------------------------------------------------------------------
  app.patch<{
    Params: { workspaceId: string; toolId: string };
    Body: UpdateToolBody;
  }>(
    "/workspaces/:workspaceId/tools/:toolId",
    {
      schema: { body: UPDATE_TOOL_SCHEMA },
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireToolUpdate,
      ]),
    },
    async (req) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.toolId, "toolId");
      // Defense-in-depth: refuse promotion-status changes at the route
      // boundary too. The service enforces the same rule (so any
      // non-route caller stays gated), but the route refusal makes
      // the contract explicit at the HTTP edge and lets the
      // route-level test exercise the rule without the DB.
      // v4 §17 — promote-to-validated/trusted is a high-risk action
      // owned by the L4.6 approval-decide endpoint.
      if (req.body.status === "trusted" || req.body.status === "validated") {
        throw new SecureCoreError(
          "INPUT_INVALID",
          "Use promote-request for validated/trusted transitions.",
          { reason: "use_promote_request" },
        );
      }
      const row = await service.updateTool({
        workspaceId: req.params.workspaceId,
        toolId: req.params.toolId,
        name: req.body.name,
        status: req.body.status,
        actorUserId: req.auth.userId,
        requestId: req.requestId,
      });
      return { tool: row };
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/tools/:toolId/promote-request
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string; toolId: string };
    Body: PromoteRequestBody;
  }>(
    "/workspaces/:workspaceId/tools/:toolId/promote-request",
    {
      schema: { body: PROMOTE_REQUEST_SCHEMA },
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireToolRequestPromotion,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.toolId, "toolId");
      const row = await service.requestPromotion({
        workspaceId: req.params.workspaceId,
        toolId: req.params.toolId,
        targetStatus: req.body.target_status,
        actorUserId: req.auth.userId,
        requestId: req.requestId,
      });
      return reply.code(201).send({ promotion_request: row });
    },
  );
};

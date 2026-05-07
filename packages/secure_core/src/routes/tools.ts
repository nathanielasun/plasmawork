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
 * PATCH path does not expose `status` at all; lifecycle transitions
 * are owned by the promote-request / approval-decide flow. The service
 * still refuses direct validated/trusted status changes for non-route
 * callers as defense-in-depth.
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
import {
  InputInvalidError,
  SecureCoreError,
  NotFoundError,
} from "../errors/shapes.js";
import type { AuditLogger } from "../audit/logger.js";
import { bodyValidation } from "./validation.js";

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
  readonly auditLogger: AuditLogger;
  readonly sourceArtifacts: ToolSourceArtifactResolver;
  readonly mw: ToolRoutesMiddleware;
}

export interface ToolSourceArtifact {
  readonly storage_path: string;
  readonly content_hash: string | null;
}

export interface ToolSourceArtifactResolver {
  getArtifactOrThrow(
    workspaceId: string,
    artifactId: string,
  ): Promise<ToolSourceArtifact>;
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
  source_artifact_id: string;
}
interface UpdateToolBody {
  name?: string;
}
interface PromoteRequestBody {
  target_status: "candidate" | "validated" | "trusted";
}

const CREATE_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "source_artifact_id"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    source_artifact_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

const UPDATE_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
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
  const validateCreateTool = bodyValidation(
    CREATE_TOOL_SCHEMA,
    opts.auditLogger,
  );
  const validateUpdateTool = bodyValidation(
    UPDATE_TOOL_SCHEMA,
    opts.auditLogger,
  );
  const validatePromotionRequest = bodyValidation(
    PROMOTE_REQUEST_SCHEMA,
    opts.auditLogger,
  );

  async function resolveSourceArtifact(
    workspaceId: string,
    artifactId: string,
  ): Promise<{ contentHash: string; storagePath: string }> {
    const artifact = await opts.sourceArtifacts.getArtifactOrThrow(
      workspaceId,
      artifactId,
    );
    if (artifact.content_hash === null || artifact.content_hash.length === 0) {
      throw new InputInvalidError("Source artifact must have a content hash.", {
        field: "source_artifact_id",
      });
    }
    return {
      contentHash: artifact.content_hash,
      storagePath: artifact.storage_path,
    };
  }

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
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateCreateTool,
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
      const source = await resolveSourceArtifact(
        req.params.workspaceId,
        req.body.source_artifact_id,
      );
      const row = await service.createTool({
        workspaceId: req.params.workspaceId,
        name: req.body.name,
        contentHash: source.contentHash,
        storagePath: source.storagePath,
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
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateUpdateTool,
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
      const row = await service.updateTool({
        workspaceId: req.params.workspaceId,
        toolId: req.params.toolId,
        name: req.body.name,
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
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validatePromotionRequest,
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

/**
 * Capsule routes — Phase 0.5 Layer 4 task L4.2.
 *
 * v4 §10.2 endpoints:
 *
 *   GET    /workspaces/:workspaceId/capsules
 *   POST   /workspaces/:workspaceId/capsules
 *   GET    /workspaces/:workspaceId/capsules/:capsuleId
 *   PATCH  /workspaces/:workspaceId/capsules/:capsuleId
 *   POST   /workspaces/:workspaceId/capsules/:capsuleId/fork
 *
 * Read endpoints skip CSRF (idempotent). Write endpoints include the
 * full §6.2 chain via `composeMiddleware()`. Capability-bound
 * preHandlers are constructed by the registering app and passed in
 * through `CapsuleRoutesMiddleware`.
 *
 * v4 §20 — `PATCH` honors the `If-Match` request header as the
 * `expectedBaseVersionId`. Missing header -> 400 INPUT_INVALID with
 * `{ reason: "missing_if_match" }`. `VersionConflictError` thrown by
 * the service maps to 409 via the L1.4 error mapper, with
 * `currentVersionId` / `submittedBaseVersionId` carried in `details`.
 *
 * Hard rules upheld:
 *   - Routes never read actor identity (`actor`, `actor_user_id`,
 *     `created_by`, `requested_by`) from `req.body`.
 *   - Body schemas are `additionalProperties: false`; UUID path
 *     params are validated via `assertUuid`.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import type { CapsuleVersionLockService } from "../capsules/versionLock.js";
import {
  InputInvalidError,
  SecureCoreError,
  NotFoundError,
} from "../errors/shapes.js";
import type { AuditLogger } from "../audit/logger.js";
import { bodyValidation } from "./validation.js";

/**
 * Capability-bound + chain middleware bundle for capsule routes. The
 * registering app constructs each entry with already-resolved L2 deps
 * and passes the bundle in.
 */
export interface CapsuleRoutesMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  readonly loadWorkspace: NamedMiddleware;
  readonly enforceUniformNotFound: NamedMiddleware;
  readonly requireWorkspaceMembership: NamedMiddleware;
  /** `capsule:read` capability-bound mw (list + read). */
  readonly requireCapsuleRead: NamedMiddleware;
  /** `capsule:create` capability-bound mw (create). */
  readonly requireCapsuleCreate: NamedMiddleware;
  /** `capsule:update` capability-bound mw (PATCH). */
  readonly requireCapsuleUpdate: NamedMiddleware;
  /** `capsule:fork` capability-bound mw (fork). */
  readonly requireCapsuleFork: NamedMiddleware;
}

export interface CapsuleRoutesOptions {
  readonly service: CapsuleVersionLockService;
  readonly auditLogger: AuditLogger;
  readonly sourceArtifacts: CapsuleSourceArtifactResolver;
  readonly mw: CapsuleRoutesMiddleware;
}

export interface CapsuleSourceArtifact {
  readonly storage_path: string;
  readonly content_hash: string | null;
}

export interface CapsuleSourceArtifactResolver {
  getArtifactOrThrow(
    workspaceId: string,
    artifactId: string,
  ): Promise<CapsuleSourceArtifact>;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new NotFoundError(`Not found.`, { param: label });
  }
  return value;
}

interface CreateCapsuleBody {
  name: string;
  source_artifact_id: string;
}
interface UpdateCapsuleBody {
  source_artifact_id: string;
}
interface ForkCapsuleBody {
  name: string;
}

const CREATE_CAPSULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "source_artifact_id"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    source_artifact_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

const UPDATE_CAPSULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["source_artifact_id"],
  properties: {
    source_artifact_id: { type: "string", pattern: UUID_V4.source },
  },
} as const;

const FORK_CAPSULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

export const capsuleRoutes: FastifyPluginAsync<CapsuleRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service, mw } = opts;
  const validateCreateCapsule = bodyValidation(
    CREATE_CAPSULE_SCHEMA,
    opts.auditLogger,
  );
  const validateUpdateCapsule = bodyValidation(
    UPDATE_CAPSULE_SCHEMA,
    opts.auditLogger,
  );
  const validateForkCapsule = bodyValidation(
    FORK_CAPSULE_SCHEMA,
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
  // GET /workspaces/:workspaceId/capsules — list capsules
  // -------------------------------------------------------------------
  app.get<{ Params: { workspaceId: string } }>(
    "/workspaces/:workspaceId/capsules",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireCapsuleRead,
      ]),
    },
    async (req) => {
      assertUuid(req.params.workspaceId, "workspaceId");
      const rows = await service.listCapsules(req.params.workspaceId);
      return { capsules: rows };
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/capsules — create capsule
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string };
    Body: CreateCapsuleBody;
  }>(
    "/workspaces/:workspaceId/capsules",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateCreateCapsule,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireCapsuleCreate,
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
      const result = await service.createCapsule({
        workspaceId: req.params.workspaceId,
        name: req.body.name,
        createdBy: req.auth.userId,
        actorType: req.auth.actorType === "ai_agent" ? "ai_agent" : "human",
        requestId: req.requestId,
        contentHash: source.contentHash,
        storagePath: source.storagePath,
      });
      return reply.code(201).send({
        capsule_id: result.capsuleId,
        version_id: result.versionId,
        version_number: result.versionNumber,
      });
    },
  );

  // -------------------------------------------------------------------
  // GET /workspaces/:workspaceId/capsules/:capsuleId — read one
  // -------------------------------------------------------------------
  app.get<{ Params: { workspaceId: string; capsuleId: string } }>(
    "/workspaces/:workspaceId/capsules/:capsuleId",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireCapsuleRead,
      ]),
    },
    async (req) => {
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.capsuleId, "capsuleId");
      const row = await service.getCapsule(
        req.params.capsuleId,
        req.params.workspaceId,
      );
      return { capsule: row };
    },
  );

  // -------------------------------------------------------------------
  // PATCH /workspaces/:workspaceId/capsules/:capsuleId — If-Match update
  // -------------------------------------------------------------------
  app.patch<{
    Params: { workspaceId: string; capsuleId: string };
    Body: UpdateCapsuleBody;
  }>(
    "/workspaces/:workspaceId/capsules/:capsuleId",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateUpdateCapsule,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireCapsuleUpdate,
      ]),
    },
    async (req) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.capsuleId, "capsuleId");
      const source = await resolveSourceArtifact(
        req.params.workspaceId,
        req.body.source_artifact_id,
      );

      const ifMatchHeaderRaw = req.headers["if-match"];
      const ifMatch = Array.isArray(ifMatchHeaderRaw)
        ? ifMatchHeaderRaw[0]
        : ifMatchHeaderRaw;
      if (typeof ifMatch !== "string" || ifMatch.length === 0) {
        throw new SecureCoreError(
          "INPUT_INVALID",
          "Missing If-Match header.",
          { reason: "missing_if_match" },
        );
      }

      const result = await service.updateCapsule({
        capsuleId: req.params.capsuleId,
        workspaceId: req.params.workspaceId,
        expectedBaseVersionId: ifMatch,
        newContent: {
          contentHash: source.contentHash,
          storagePath: source.storagePath,
        },
        actorUserId: req.auth.userId,
        actorType: req.auth.actorType === "ai_agent" ? "ai_agent" : "human",
        requestId: req.requestId,
      });
      return {
        new_version_id: result.newVersionId,
        version_number: result.versionNumber,
      };
    },
  );

  // -------------------------------------------------------------------
  // POST /workspaces/:workspaceId/capsules/:capsuleId/fork — fork
  // -------------------------------------------------------------------
  app.post<{
    Params: { workspaceId: string; capsuleId: string };
    Body: ForkCapsuleBody;
  }>(
    "/workspaces/:workspaceId/capsules/:capsuleId/fork",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        validateForkCapsule,
        mw.attachAuditActor,
        mw.loadWorkspace,
        mw.enforceUniformNotFound,
        mw.requireWorkspaceMembership,
        mw.requireCapsuleFork,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      assertUuid(req.params.workspaceId, "workspaceId");
      assertUuid(req.params.capsuleId, "capsuleId");

      // Resolve the source version id from the source capsule's head.
      const source = await service.getCapsule(
        req.params.capsuleId,
        req.params.workspaceId,
      );
      if (source.current_version_id === null) {
        throw new NotFoundError("Capsule has no current version.", {
          capsule_id: req.params.capsuleId,
        });
      }

      const result = await service.forkCapsule({
        sourceCapsuleId: req.params.capsuleId,
        sourceVersionId: source.current_version_id,
        targetWorkspaceId: req.params.workspaceId,
        newCapsuleName: req.body.name,
        actorUserId: req.auth.userId,
        actorType: req.auth.actorType === "ai_agent" ? "ai_agent" : "human",
        requestId: req.requestId,
      });
      return reply.code(201).send({
        new_capsule_id: result.newCapsuleId,
        new_version_id: result.newVersionId,
      });
    },
  );
};

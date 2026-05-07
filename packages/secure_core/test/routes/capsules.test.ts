/**
 * L4.2 — capsule route tests.
 *
 * Pure-logic. Stubbed `CapsuleVersionLockService` + passthrough mw
 * bundle. DB-bound lock semantics are pinned by the L3.4 service's
 * own DB-gated tests in `test/capsules/versionLock.test.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

import {
  capsuleRoutes,
  type CapsuleSourceArtifactResolver,
  type CapsuleRoutesMiddleware,
} from "../../src/routes/capsules.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import {
  SecureCoreError,
  NotFoundError,
  VersionConflictError,
} from "../../src/errors/shapes.js";
import type {
  AuthContext,
  AuditContext,
  MembershipContext,
  WorkspaceContext,
} from "../../src/middleware/types.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type {
  CapsuleRow,
  CapsuleVersionLockService,
  CreateCapsuleOptions,
  CreateCapsuleResult,
  ForkCapsuleOptions,
  ForkCapsuleResult,
  UpdateCapsuleOptions,
  UpdateCapsuleResult,
} from "../../src/capsules/versionLock.js";

const VALID_WS = "11111111-1111-4111-8111-111111111111";
const VALID_CAP = "22222222-2222-4222-8222-222222222222";
const NEW_CAP = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const VERSION_A = "55555555-5555-4555-8555-555555555555";
const VERSION_B = "66666666-6666-4666-8666-666666666666";
const VALID_ARTIFACT = "77777777-7777-4777-8777-777777777777";
const auditLogger = { write: async () => {} } as unknown as AuditLogger;
const sourceArtifacts: CapsuleSourceArtifactResolver = {
  async getArtifactOrThrow(_workspaceId: string, _artifactId: string) {
    return {
      content_hash: "sha256:abc",
      storage_path: "ws/cap-x/v1.tar",
    };
  },
};

interface ServiceCalls {
  listCapsules: string[];
  getCapsule: Array<{ capsuleId: string; workspaceId: string }>;
  createCapsule: CreateCapsuleOptions[];
  updateCapsule: UpdateCapsuleOptions[];
  forkCapsule: ForkCapsuleOptions[];
}

type StubOverrides = Partial<
  Pick<
    CapsuleVersionLockService,
    "listCapsules" | "getCapsule" | "createCapsule" | "updateCapsule" | "forkCapsule"
  >
>;

function makeStubService(
  overrides: StubOverrides = {},
): { service: CapsuleVersionLockService; calls: ServiceCalls } {
  const calls: ServiceCalls = {
    listCapsules: [],
    getCapsule: [],
    createCapsule: [],
    updateCapsule: [],
    forkCapsule: [],
  };
  const baseRow: CapsuleRow = {
    id: VALID_CAP,
    workspace_id: VALID_WS,
    name: "cap-1",
    current_version_id: VERSION_A,
    created_by: ACTOR,
    created_at: new Date(),
    deleted_at: null,
  };
  const service = {
    async listCapsules(workspaceId: string) {
      calls.listCapsules.push(workspaceId);
      return [baseRow];
    },
    async getCapsule(capsuleId: string, workspaceId: string) {
      calls.getCapsule.push({ capsuleId, workspaceId });
      return baseRow;
    },
    async createCapsule(opts: CreateCapsuleOptions): Promise<CreateCapsuleResult> {
      calls.createCapsule.push(opts);
      return {
        capsuleId: opts.capsuleId ?? VALID_CAP,
        versionId: VERSION_A,
        versionNumber: 1,
      };
    },
    async updateCapsule(opts: UpdateCapsuleOptions): Promise<UpdateCapsuleResult> {
      calls.updateCapsule.push(opts);
      return { newVersionId: VERSION_B, versionNumber: 2 };
    },
    async forkCapsule(opts: ForkCapsuleOptions): Promise<ForkCapsuleResult> {
      calls.forkCapsule.push(opts);
      return {
        newCapsuleId: opts.newCapsuleId ?? NEW_CAP,
        newVersionId: VERSION_B,
      };
    },
    ...overrides,
  } as unknown as CapsuleVersionLockService;
  return { service, calls };
}

const baseAuth: AuthContext = {
  userId: ACTOR,
  sessionId: "sess-1",
  actorType: "human",
  assuranceLevel: "aal2",
};
const baseAudit: AuditContext = {
  actorUserId: ACTOR,
  actorType: "human",
  requestId: "req-test",
};
const baseWorkspace: WorkspaceContext = {
  id: VALID_WS,
  name: "ws-1",
  createdBy: ACTOR,
};
const baseMembership: MembershipContext = {
  workspaceId: VALID_WS,
  userId: ACTOR,
  roleId: "role-admin",
  roleName: "WorkspaceAdmin",
  capabilities: new Set([
    "capsule:read",
    "capsule:create",
    "capsule:update",
    "capsule:fork",
  ] as const),
};

interface MwOpts {
  authed?: boolean;
  readAllowed?: boolean;
  createAllowed?: boolean;
  updateAllowed?: boolean;
  forkAllowed?: boolean;
}

function makeMiddlewareBundle(opts: MwOpts): CapsuleRoutesMiddleware {
  type MwName =
    | "requireAuth"
    | "enforceCsrfForStateChange"
    | "attachAuditActor"
    | "loadWorkspace"
    | "enforceUniformNotFound"
    | "requireWorkspaceMembership"
    | "requireCapability";

  const wrap = (
    name: MwName,
    capAllowed?: boolean,
  ): CapsuleRoutesMiddleware["requireAuth"] => ({
    name,
    handler: async (req) => {
      if (name === "requireAuth") {
        if (opts.authed === false) {
          throw new SecureCoreError("UNAUTHENTICATED", "no auth.");
        }
        req.auth = baseAuth;
      }
      if (name === "attachAuditActor") req.audit = baseAudit;
      if (name === "loadWorkspace") req.workspace = baseWorkspace;
      if (name === "requireWorkspaceMembership") req.membership = baseMembership;
      if (name === "requireCapability" && capAllowed === false) {
        throw new SecureCoreError("PERMISSION_DENIED", "no capability.");
      }
    },
  });

  return {
    requireAuth: wrap("requireAuth"),
    enforceCsrfForStateChange: wrap("enforceCsrfForStateChange"),
    attachAuditActor: wrap("attachAuditActor"),
    loadWorkspace: wrap("loadWorkspace"),
    enforceUniformNotFound: wrap("enforceUniformNotFound"),
    requireWorkspaceMembership: wrap("requireWorkspaceMembership"),
    requireCapsuleRead: wrap("requireCapability", opts.readAllowed),
    requireCapsuleCreate: wrap("requireCapability", opts.createAllowed),
    requireCapsuleUpdate: wrap("requireCapability", opts.updateAllowed),
    requireCapsuleFork: wrap("requireCapability", opts.forkAllowed),
  };
}

function buildApp(
  service: CapsuleVersionLockService,
  mw: CapsuleRoutesMiddleware,
): FastifyInstance {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
        useDefaults: false,
        coerceTypes: false,
        allErrors: false,
        strict: false,
      },
    },
  });
  app.addHook("onRequest", requireRequestId);
  app.setErrorHandler((err, req, reply) => {
    const fErr = err as Error & {
      statusCode?: number;
      validation?: unknown;
    };
    if (
      typeof fErr.statusCode === "number" &&
      fErr.statusCode === 400 &&
      fErr.validation !== undefined
    ) {
      reply.code(400).send({
        error: {
          code: "INPUT_INVALID",
          message: "Schema validation failed.",
          request_id: req.requestId ?? "unknown",
        },
      });
      return;
    }
    const mapped = toHttpResponse(
      err instanceof SecureCoreError ? err : err,
      req.requestId ?? "unknown",
    );
    reply.code(mapped.status).send(mapped.body);
  });
  app.register(capsuleRoutes, {
    service,
    auditLogger,
    sourceArtifacts,
    mw,
  });
  return app;
}

describe("L4.2 — capsule routes", () => {
  let stub: ReturnType<typeof makeStubService>;

  beforeEach(() => {
    stub = makeStubService();
  });

  it("GET /workspaces/:id/capsules lists capsules", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/capsules`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { capsules: Array<{ id: string }> };
    expect(body.capsules).toHaveLength(1);
    expect(stub.calls.listCapsules).toEqual([VALID_WS]);
  });

  it("GET /capsules/:id returns 404 on non-UUID capsule id", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/capsules/not-a-uuid`,
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET /capsules/:id returns the capsule row", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}`,
    });
    expect(r.statusCode).toBe(200);
    expect(stub.calls.getCapsule[0]).toEqual({
      capsuleId: VALID_CAP,
      workspaceId: VALID_WS,
    });
  });

  it("POST /capsules creates and returns 201", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules`,
      payload: {
        name: "cap-x",
        source_artifact_id: VALID_ARTIFACT,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(stub.calls.createCapsule[0]).toMatchObject({
      workspaceId: VALID_WS,
      name: "cap-x",
      createdBy: ACTOR,
      contentHash: "sha256:abc",
      storagePath: "ws/cap-x/v1.tar",
    });
  });

  it("POST /capsules rejects extra body fields (additionalProperties: false)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules`,
      payload: {
        name: "cap-x",
        source_artifact_id: VALID_ARTIFACT,
        content_hash: "sha256:abc",
        storage_path: "ws/cap-x/v1.tar",
        actor_user_id: "evil",
      },
    });
    expect(r.statusCode).toBe(400);
    expect(stub.calls.createCapsule).toHaveLength(0);
  });

  it("POST /capsules rejects missing required field", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules`,
      payload: { name: "cap-x" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("POST /capsules denies without capsule:create capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ createAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules`,
      payload: {
        name: "cap-x",
        source_artifact_id: VALID_ARTIFACT,
      },
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.createCapsule).toHaveLength(0);
  });

  it("PATCH /capsules updates with If-Match", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}`,
      headers: { "if-match": VERSION_A },
      payload: {
        source_artifact_id: VALID_ARTIFACT,
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { new_version_id: string };
    expect(body.new_version_id).toBe(VERSION_B);
    expect(stub.calls.updateCapsule[0]).toMatchObject({
      capsuleId: VALID_CAP,
      workspaceId: VALID_WS,
      expectedBaseVersionId: VERSION_A,
      actorUserId: ACTOR,
    });
  });

  it("PATCH /capsules without If-Match returns 400 INPUT_INVALID", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}`,
      payload: {
        source_artifact_id: VALID_ARTIFACT,
      },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; details?: { reason?: string } } };
    expect(body.error.code).toBe("INPUT_INVALID");
    expect(body.error.details?.reason).toBe("missing_if_match");
    expect(stub.calls.updateCapsule).toHaveLength(0);
  });

  it("PATCH /capsules surfaces VersionConflictError as 409 with currentVersionId", async () => {
    const stub2 = makeStubService({
      updateCapsule: (async () => {
        throw new VersionConflictError(
          "Capsule was modified after this version was loaded.",
          {
            conflict: "stale_base_version",
            currentVersionId: VERSION_B,
            submittedBaseVersionId: VERSION_A,
          },
        );
      }) as unknown as CapsuleVersionLockService["updateCapsule"],
    });
    const app = buildApp(stub2.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}`,
      headers: { "if-match": VERSION_A },
      payload: {
        source_artifact_id: VALID_ARTIFACT,
      },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json() as {
      error: {
        code: string;
        details?: {
          currentVersionId?: string;
          submittedBaseVersionId?: string;
        };
      };
    };
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(body.error.details?.currentVersionId).toBe(VERSION_B);
    expect(body.error.details?.submittedBaseVersionId).toBe(VERSION_A);
  });

  it("PATCH /capsules denies without capsule:update capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ updateAllowed: false }),
    );
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}`,
      headers: { "if-match": VERSION_A },
      payload: {
        source_artifact_id: VALID_ARTIFACT,
      },
    });
    expect(r.statusCode).toBe(403);
  });

  it("POST /capsules/:id/fork forks and returns 201", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}/fork`,
      payload: { name: "cap-fork" },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { new_capsule_id: string; new_version_id: string };
    expect(body.new_capsule_id).toBe(NEW_CAP);
    expect(body.new_version_id).toBe(VERSION_B);
    expect(stub.calls.forkCapsule[0]).toMatchObject({
      sourceCapsuleId: VALID_CAP,
      sourceVersionId: VERSION_A,
      targetWorkspaceId: VALID_WS,
      newCapsuleName: "cap-fork",
      actorUserId: ACTOR,
    });
  });

  it("POST /capsules/:id/fork denies without capsule:fork capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ forkAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}/fork`,
      payload: { name: "cap-fork" },
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.forkCapsule).toHaveLength(0);
  });

  it("GET /capsules/:id surfaces NotFoundError as 404", async () => {
    const stub2 = makeStubService({
      getCapsule: (async () => {
        throw new NotFoundError("Capsule not found.", {
          capsule_id: VALID_CAP,
        });
      }) as unknown as CapsuleVersionLockService["getCapsule"],
    });
    const app = buildApp(stub2.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}`,
    });
    expect(r.statusCode).toBe(404);
  });
});

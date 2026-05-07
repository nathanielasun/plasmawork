/**
 * L4.4 — tool route tests.
 *
 * Pure-logic. Stubbed `ToolService` + passthrough middleware bundle
 * (every middleware pre-populates the `req.auth` / `req.workspace`
 * / `req.membership` / `req.audit` fields its real counterpart
 * would set). DB-bound behavior is pinned by the service's own
 * DB-gated tests under `test/tools/`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

import {
  toolRoutes,
  type ToolSourceArtifactResolver,
  type ToolRoutesMiddleware,
} from "../../src/routes/tools.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError, NotFoundError } from "../../src/errors/shapes.js";
import type {
  AuthContext,
  AuditContext,
  MembershipContext,
  WorkspaceContext,
} from "../../src/middleware/types.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type {
  CreateToolOptions,
  RequestPromotionOptions,
  ToolPromotionRequestRow,
  ToolRow,
  ToolService,
  ToolWithVersionRow,
  UpdateToolOptions,
} from "../../src/tools/service.js";

const VALID_WS = "11111111-1111-4111-8111-111111111111";
const VALID_TOOL = "44444444-4444-4444-8444-444444444444";
const GLOBAL_TOOL = "55555555-5555-4555-8555-555555555555";
const VALID_ARTIFACT = "66666666-6666-4666-8666-666666666666";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const auditLogger = { write: async () => {} } as unknown as AuditLogger;
const sourceArtifacts: ToolSourceArtifactResolver = {
  async getArtifactOrThrow(_workspaceId: string, _artifactId: string) {
    return {
      content_hash: "sha256:abc",
      storage_path: "tools/foo.py",
    };
  },
};

// -------------------------------------------------------------------
// Stubs
// -------------------------------------------------------------------

interface ServiceCalls {
  listForWorkspace: string[];
  getTool: Array<{ workspaceId: string; toolId: string }>;
  createTool: CreateToolOptions[];
  updateTool: UpdateToolOptions[];
  requestPromotion: RequestPromotionOptions[];
}

function makeStubService(): { service: ToolService; calls: ServiceCalls } {
  const calls: ServiceCalls = {
    listForWorkspace: [],
    getTool: [],
    createTool: [],
    updateTool: [],
    requestPromotion: [],
  };
  const baseTool: ToolRow = {
    id: VALID_TOOL,
    workspace_id: VALID_WS,
    name: "tool-1",
    status: "draft",
    created_by: ACTOR,
    created_at: new Date(),
  };
  const globalTool: ToolRow = {
    id: GLOBAL_TOOL,
    workspace_id: null,
    name: "global-tool",
    status: "trusted",
    created_by: ACTOR,
    created_at: new Date(),
  };
  const service = {
    async listForWorkspace(workspaceId: string) {
      calls.listForWorkspace.push(workspaceId);
      // Per v4 §10.3 — workspace-owned + global trusted
      return [baseTool, globalTool];
    },
    async getTool(workspaceId: string, toolId: string) {
      calls.getTool.push({ workspaceId, toolId });
      const row: ToolWithVersionRow = {
        ...baseTool,
        id: toolId,
        current_version: {
          id: "v-1",
          tool_id: toolId,
          workspace_id: workspaceId,
          version_number: 1,
          content_hash: "sha256:abc",
          storage_path: "tools/foo.py",
          created_by: ACTOR,
          created_at: new Date(),
        },
      };
      return row;
    },
    async createTool(opts: CreateToolOptions) {
      calls.createTool.push(opts);
      return { ...baseTool, name: opts.name };
    },
    async updateTool(opts: UpdateToolOptions) {
      calls.updateTool.push(opts);
      return {
        ...baseTool,
        name: opts.name ?? baseTool.name,
        status: opts.status ?? baseTool.status,
      };
    },
    async requestPromotion(opts: RequestPromotionOptions) {
      calls.requestPromotion.push(opts);
      const row: ToolPromotionRequestRow = {
        id: "promo-1",
        workspace_id: opts.workspaceId,
        tool_id: opts.toolId,
        requested_by: opts.actorUserId,
        status: "pending",
        decided_by: null,
        created_at: new Date(),
        decided_at: null,
      };
      return row;
    },
  } as unknown as ToolService;
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
    "tool:read",
    "tool:create",
    "tool:update",
    "tool:request_promotion",
  ] as const),
};

interface BundleOptions {
  authed?: boolean;
  toolReadAllowed?: boolean;
  toolCreateAllowed?: boolean;
  toolUpdateAllowed?: boolean;
  toolPromoteRequestAllowed?: boolean;
}

function makeMiddlewareBundle(opts: BundleOptions): ToolRoutesMiddleware {
  type MwName =
    | "requireAuth"
    | "enforceCsrfForStateChange"
    | "attachAuditActor"
    | "loadWorkspace"
    | "enforceUniformNotFound"
    | "requireWorkspaceMembership"
    | "requireToolRead"
    | "requireToolCreate"
    | "requireToolUpdate"
    | "requireToolRequestPromotion";

  const realName = (name: MwName): import("../../src/middleware/compose.js").MiddlewareName => {
    switch (name) {
      case "requireAuth":
        return "requireAuth";
      case "enforceCsrfForStateChange":
        return "enforceCsrfForStateChange";
      case "attachAuditActor":
        return "attachAuditActor";
      case "loadWorkspace":
        return "loadWorkspace";
      case "enforceUniformNotFound":
        return "enforceUniformNotFound";
      case "requireWorkspaceMembership":
        return "requireWorkspaceMembership";
      case "requireToolRead":
      case "requireToolCreate":
      case "requireToolUpdate":
      case "requireToolRequestPromotion":
        return "requireCapability";
    }
  };

  const wrap = (name: MwName): ToolRoutesMiddleware[MwName] => ({
    name: realName(name),
    handler: async (req) => {
      if (name === "requireAuth") {
        if (opts.authed === false) {
          throw new SecureCoreError("UNAUTHENTICATED", "no auth.");
        }
        req.auth = baseAuth;
        return;
      }
      if (name === "attachAuditActor") {
        req.audit = baseAudit;
        return;
      }
      if (name === "loadWorkspace") {
        req.workspace = baseWorkspace;
        return;
      }
      if (name === "requireWorkspaceMembership") {
        req.membership = baseMembership;
        return;
      }
      if (name === "requireToolRead" && opts.toolReadAllowed === false) {
        throw new SecureCoreError("PERMISSION_DENIED", "no tool:read.");
      }
      if (name === "requireToolCreate" && opts.toolCreateAllowed === false) {
        throw new SecureCoreError("PERMISSION_DENIED", "no tool:create.");
      }
      if (name === "requireToolUpdate" && opts.toolUpdateAllowed === false) {
        throw new SecureCoreError("PERMISSION_DENIED", "no tool:update.");
      }
      if (
        name === "requireToolRequestPromotion" &&
        opts.toolPromoteRequestAllowed === false
      ) {
        throw new SecureCoreError(
          "PERMISSION_DENIED",
          "no tool:request_promotion.",
        );
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
    requireToolRead: wrap("requireToolRead"),
    requireToolCreate: wrap("requireToolCreate"),
    requireToolUpdate: wrap("requireToolUpdate"),
    requireToolRequestPromotion: wrap("requireToolRequestPromotion"),
  };
}

function buildApp(
  service: ToolService,
  mw: ToolRoutesMiddleware,
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
  app.register(toolRoutes, { service, auditLogger, sourceArtifacts, mw });
  return app;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("L4.4 — tool routes", () => {
  let stub: ReturnType<typeof makeStubService>;

  beforeEach(() => {
    stub = makeStubService();
  });

  it("GET /tools lists workspace + global trusted tools (v4 §10.3)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/tools`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { tools: ToolRow[] };
    expect(body.tools).toHaveLength(2);
    expect(body.tools.find((t) => t.workspace_id === null)?.status).toBe(
      "trusted",
    );
    expect(stub.calls.listForWorkspace).toEqual([VALID_WS]);
  });

  it("POST /tools creates and returns 201", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/tools`,
      payload: {
        name: "tool-1",
        source_artifact_id: VALID_ARTIFACT,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(stub.calls.createTool[0]).toMatchObject({
      workspaceId: VALID_WS,
      name: "tool-1",
      contentHash: "sha256:abc",
      storagePath: "tools/foo.py",
      actorUserId: ACTOR,
    });
  });

  it("POST /tools rejects missing required fields (Ajv schema)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/tools`,
      payload: { name: "tool-1" },
    });
    expect(r.statusCode).toBe(400);
    expect(stub.calls.createTool).toHaveLength(0);
  });

  it("POST /tools rejects extra fields (additionalProperties: false)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/tools`,
      payload: {
        name: "tool-1",
        source_artifact_id: VALID_ARTIFACT,
        content_hash: "sha256:abc",
        storage_path: "tools/foo.py",
        actor_user_id: "evil",
      },
    });
    expect(r.statusCode).toBe(400);
    expect(stub.calls.createTool).toHaveLength(0);
  });

  it("GET /tools/:id reads a single tool", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/tools/${VALID_TOOL}`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { tool: ToolWithVersionRow };
    expect(body.tool.id).toBe(VALID_TOOL);
    expect(body.tool.current_version?.version_number).toBe(1);
    expect(stub.calls.getTool[0]).toEqual({
      workspaceId: VALID_WS,
      toolId: VALID_TOOL,
    });
  });

  it("PATCH /tools/:id allows name updates only", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/tools/${VALID_TOOL}`,
      payload: { name: "tool-renamed" },
    });
    expect(r.statusCode).toBe(200);
    expect(stub.calls.updateTool[0]).toMatchObject({
      workspaceId: VALID_WS,
      toolId: VALID_TOOL,
      name: "tool-renamed",
      actorUserId: ACTOR,
    });
    expect(stub.calls.updateTool[0]?.status).toBeUndefined();
  });

  it("PATCH /tools/:id rejects any client-supplied status before service", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/tools/${VALID_TOOL}`,
      payload: { status: "trusted" },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as {
      error: { code: string; details?: { field?: string } };
    };
    expect(body.error.code).toBe("UNEXPECTED_FIELD");
    expect(body.error.details?.field).toBe("status");
    expect(stub.calls.updateTool).toHaveLength(0);
  });

  it("PATCH /tools/:id keeps validated promotion behind promote-request", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/tools/${VALID_TOOL}`,
      payload: { status: "validated" },
    });
    expect(r.statusCode).toBe(400);
    expect(stub.calls.updateTool).toHaveLength(0);
  });

  it("POST /tools/:id/promote-request creates pending request", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/tools/${VALID_TOOL}/promote-request`,
      payload: { target_status: "trusted" },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { promotion_request: ToolPromotionRequestRow };
    expect(body.promotion_request.status).toBe("pending");
    expect(stub.calls.requestPromotion[0]).toMatchObject({
      workspaceId: VALID_WS,
      toolId: VALID_TOOL,
      targetStatus: "trusted",
      actorUserId: ACTOR,
    });
  });

  it("POST /tools refuses without tool:create capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ toolCreateAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/tools`,
      payload: {
        name: "tool-1",
        source_artifact_id: VALID_ARTIFACT,
      },
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.createTool).toHaveLength(0);
  });

  it("PATCH /tools refuses without tool:update capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ toolUpdateAllowed: false }),
    );
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/tools/${VALID_TOOL}`,
      payload: { name: "tool-renamed" },
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.updateTool).toHaveLength(0);
  });

  it("GET /tools/:id refuses non-UUID toolId with 404", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/tools/not-a-uuid`,
    });
    expect(r.statusCode).toBe(404);
    expect(stub.calls.getTool).toHaveLength(0);
  });

  it("GET /tools/:id surfaces NotFoundError as 404", async () => {
    const stub2 = makeStubService();
    stub2.service.getTool = (async () => {
      throw new NotFoundError("Tool not found.", { tool_id: VALID_TOOL });
    }) as unknown as typeof stub2.service.getTool;
    const app = buildApp(stub2.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/tools/${VALID_TOOL}`,
    });
    expect(r.statusCode).toBe(404);
  });
});

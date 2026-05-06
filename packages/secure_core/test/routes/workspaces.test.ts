/**
 * L4.1 — workspace + members route tests.
 *
 * Pure-logic. Uses stubbed `WorkspaceService` + stubbed middleware
 * bundle (every middleware is a pass-through that pre-populates the
 * required `req.auth` / `req.workspace` / `req.membership` /
 * `req.audit` so the handler can run). DB-bound behavior is pinned
 * by the service's own DB-gated tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

import {
  workspaceRoutes,
  type WorkspaceRoutesMiddleware,
} from "../../src/routes/workspaces.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError, NotFoundError } from "../../src/errors/shapes.js";
import type {
  AuthContext,
  AuditContext,
  MembershipContext,
  WorkspaceContext,
} from "../../src/middleware/types.js";
import type {
  AddMemberOptions,
  ChangeMemberRoleOptions,
  CreateWorkspaceOptions,
  RemoveMemberOptions,
  WorkspaceService,
} from "../../src/workspaces/service.js";

const VALID_WS = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

// -------------------------------------------------------------------
// Stubs
// -------------------------------------------------------------------

interface ServiceCalls {
  createWorkspace: CreateWorkspaceOptions[];
  listForActor: string[];
  listMembers: string[];
  addMember: AddMemberOptions[];
  changeMemberRole: ChangeMemberRoleOptions[];
  removeMember: RemoveMemberOptions[];
}

function makeStubService(): { service: WorkspaceService; calls: ServiceCalls } {
  const calls: ServiceCalls = {
    createWorkspace: [],
    listForActor: [],
    listMembers: [],
    addMember: [],
    changeMemberRole: [],
    removeMember: [],
  };
  const service = {
    async createWorkspace(opts: CreateWorkspaceOptions) {
      calls.createWorkspace.push(opts);
      return {
        id: VALID_WS,
        name: opts.name,
        created_by: opts.createdByUserId,
        created_at: new Date(),
      };
    },
    async listForActor(userId: string) {
      calls.listForActor.push(userId);
      return [
        {
          id: VALID_WS,
          name: "ws-1",
          created_by: userId,
          created_at: new Date(),
        },
      ];
    },
    async listMembers(workspaceId: string) {
      calls.listMembers.push(workspaceId);
      return [
        {
          id: "mem-1",
          workspace_id: workspaceId,
          user_id: ACTOR,
          role_id: "role-1",
          role_name: "WorkspaceAdmin",
          created_at: new Date(),
        },
      ];
    },
    async addMember(opts: AddMemberOptions) {
      calls.addMember.push(opts);
      return {
        id: "mem-2",
        workspace_id: opts.workspaceId,
        user_id: opts.targetUserId,
        role_id: "role-2",
        role_name: opts.roleName,
        created_at: new Date(),
      };
    },
    async changeMemberRole(opts: ChangeMemberRoleOptions) {
      calls.changeMemberRole.push(opts);
      return {
        id: "mem-3",
        workspace_id: opts.workspaceId,
        user_id: opts.targetUserId,
        role_id: "role-3",
        role_name: opts.newRoleName,
        created_at: new Date(),
      };
    },
    async removeMember(opts: RemoveMemberOptions) {
      calls.removeMember.push(opts);
    },
  } as unknown as WorkspaceService;
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
  capabilities: new Set(["workspace:manage_members" as const]),
};

/**
 * Build a passthrough middleware bundle. Each middleware pre-populates
 * the request fields its real counterpart would set.
 */
function makeMiddlewareBundle(opts: {
  authed?: boolean;
  manageMembersAllowed?: boolean;
}): WorkspaceRoutesMiddleware {
  const wrap = (
    name:
      | "requireAuth"
      | "enforceCsrfForStateChange"
      | "attachAuditActor"
      | "loadWorkspace"
      | "enforceUniformNotFound"
      | "requireWorkspaceMembership"
      | "requireCapability",
  ): WorkspaceRoutesMiddleware[
    | "requireAuth"
    | "enforceCsrfForStateChange"
    | "attachAuditActor"
    | "loadWorkspace"
    | "enforceUniformNotFound"
    | "requireWorkspaceMembership"
    | "requireManageMembers"] => ({
    name: name === "requireCapability" ? "requireCapability" : name,
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
      if (name === "requireCapability" && opts.manageMembersAllowed === false) {
        throw new SecureCoreError("PERMISSION_DENIED", "no manage_members.");
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
    requireManageMembers: wrap("requireCapability"),
  };
}

function buildApp(
  service: WorkspaceService,
  mw: WorkspaceRoutesMiddleware,
): FastifyInstance {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        // v4 §4.1 — additionalProperties: false in our route schemas
        // MUST refuse extra fields (the L2.3 forbidden-body scan is a
        // belt-and-braces second layer; Ajv refusal is the first).
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
    // Fastify schema-validation errors surface as FastifyError with
    // statusCode 400 + `validation` array. Honour the statusCode
    // before falling back to the SecureCoreError mapper.
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
  app.register(workspaceRoutes, { service, mw });
  return app;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("L4.1 — workspace + members routes", () => {
  let stub: ReturnType<typeof makeStubService>;

  beforeEach(() => {
    stub = makeStubService();
  });

  it("GET /workspaces lists for the caller", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({ method: "GET", url: "/workspaces" });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { workspaces: Array<{ id: string }> };
    expect(body.workspaces).toHaveLength(1);
    expect(stub.calls.listForActor).toEqual([ACTOR]);
  });

  it("GET /workspaces refuses without auth", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({ authed: false }));
    const r = await app.inject({ method: "GET", url: "/workspaces" });
    expect(r.statusCode).toBe(401);
  });

  it("POST /workspaces creates and returns 201", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "lab-1" },
    });
    expect(r.statusCode).toBe(201);
    expect(stub.calls.createWorkspace[0]).toMatchObject({
      name: "lab-1",
      createdByUserId: ACTOR,
    });
  });

  it("POST /workspaces rejects missing name (Ajv schema)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it("POST /workspaces rejects extra fields (additionalProperties: false)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "lab-1", actor_user_id: "evil" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("GET /workspaces/:id/members lists members", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/members`,
    });
    expect(r.statusCode).toBe(200);
    expect(stub.calls.listMembers).toEqual([VALID_WS]);
  });

  it("GET /workspaces/:id/members refuses non-UUID workspace id", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/not-a-uuid/members`,
    });
    expect(r.statusCode).toBe(404);
  });

  it("POST /workspaces/:id/members adds a member", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/members`,
      payload: { user_id: OTHER_USER, role_name: "Researcher" },
    });
    expect(r.statusCode).toBe(201);
    expect(stub.calls.addMember[0]).toMatchObject({
      workspaceId: VALID_WS,
      targetUserId: OTHER_USER,
      roleName: "Researcher",
      actorUserId: ACTOR,
    });
  });

  it("POST /workspaces/:id/members refused without manage_members capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ manageMembersAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/members`,
      payload: { user_id: OTHER_USER, role_name: "Researcher" },
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.addMember).toHaveLength(0);
  });

  it("PATCH /workspaces/:id/members/:userId changes role", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/members/${OTHER_USER}`,
      payload: { role_name: "Reviewer" },
    });
    expect(r.statusCode).toBe(200);
    expect(stub.calls.changeMemberRole[0]).toMatchObject({
      workspaceId: VALID_WS,
      targetUserId: OTHER_USER,
      newRoleName: "Reviewer",
      actorUserId: ACTOR,
    });
  });

  it("PATCH refuses non-UUID userId param", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "PATCH",
      url: `/workspaces/${VALID_WS}/members/not-uuid`,
      payload: { role_name: "Reviewer" },
    });
    expect(r.statusCode).toBe(404);
  });

  it("DELETE /workspaces/:id/members/:userId removes the member", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "DELETE",
      url: `/workspaces/${VALID_WS}/members/${OTHER_USER}`,
    });
    expect(r.statusCode).toBe(204);
    expect(stub.calls.removeMember[0]).toMatchObject({
      workspaceId: VALID_WS,
      targetUserId: OTHER_USER,
      actorUserId: ACTOR,
    });
  });

  it("DELETE returns 404 when service throws NotFoundError", async () => {
    const stub2 = makeStubService();
    stub2.service.removeMember = (async () => {
      throw new NotFoundError("Member not found.", { workspace_id: VALID_WS });
    }) as unknown as typeof stub2.service.removeMember;
    const app = buildApp(stub2.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "DELETE",
      url: `/workspaces/${VALID_WS}/members/${OTHER_USER}`,
    });
    expect(r.statusCode).toBe(404);
  });
});

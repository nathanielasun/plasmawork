/**
 * L4.6 — approval-request route tests.
 *
 * Pure-logic. Stubbed `ApprovalService` + passthrough middleware
 * bundle (each middleware pre-populates the required req.auth /
 * req.workspace / req.membership / req.audit so the handler can
 * run). DB-bound behavior is pinned by the service's own tests.
 *
 * Mirrors the L4.1 workspaces.test.ts shape exactly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  approvalRoutes,
  type ApprovalRoutesMiddleware,
} from "../../src/routes/approvals.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import type {
  ApprovalRequestRow,
  ApprovalService,
  ApprovalTokenRow,
  ConsumeTokenOptions,
  DecideRequestOptions,
  RequestApprovalOptions,
} from "../../src/approvals/service.js";
import type { HighRiskAction } from "../../src/config/high_risk_actions.js";
import type { NamedMiddleware } from "../../src/middleware/compose.js";
import type {
  AuditContext,
  AuthContext,
  MembershipContext,
  WorkspaceContext,
} from "../../src/middleware/types.js";
import type { AuditLogger } from "../../src/audit/logger.js";

const VALID_WS = "11111111-1111-4111-8111-111111111111";
const VALID_REQ = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const auditLogger = { write: async () => {} } as unknown as AuditLogger;

// -------------------------------------------------------------------
// Stubs
// -------------------------------------------------------------------

interface ServiceCalls {
  requestApproval: RequestApprovalOptions[];
  consumeToken: ConsumeTokenOptions[];
  denyRequest: DecideRequestOptions[];
}

function makeStubService(): {
  service: ApprovalService;
  calls: ServiceCalls;
} {
  const calls: ServiceCalls = {
    requestApproval: [],
    consumeToken: [],
    denyRequest: [],
  };

  const baseRequestRow: ApprovalRequestRow = {
    id: VALID_REQ,
    workspace_id: VALID_WS,
    object_type: "capsule",
    object_id: "cap-1",
    requested_action: "expensive_run",
    requested_by: ACTOR,
    requested_by_agent: false,
    status: "pending",
    decided_by: null,
    decided_at: null,
    created_at: new Date(),
  };

  const baseTokenRow: ApprovalTokenRow = {
    id: "tok-1",
    workspace_id: VALID_WS,
    approval_request_id: VALID_REQ,
    token_hash: "hash",
    token_context_hash: "ctx",
    approver_user_id: ACTOR,
    approver_role_id: null,
    created_by: ACTOR,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 3_600_000),
    used_at: null,
    revoked_at: null,
  };

  const service = {
    async requestApproval(opts: RequestApprovalOptions) {
      calls.requestApproval.push(opts);
      return {
        ...baseRequestRow,
        workspace_id: opts.workspaceId,
        object_type: opts.objectType,
        object_id: opts.objectId,
        requested_action: opts.requestedAction,
        requested_by: opts.requestedBy,
        requested_by_agent: opts.requestedByAgent,
      };
    },
    async consumeToken(opts: ConsumeTokenOptions) {
      calls.consumeToken.push(opts);
      return {
        requestRow: { ...baseRequestRow, status: "approved" },
        tokenRow: { ...baseTokenRow, used_at: new Date() },
      };
    },
    async denyRequest(opts: DecideRequestOptions) {
      calls.denyRequest.push(opts);
      return {
        ...baseRequestRow,
        status: "denied",
        decided_by: opts.decidedBy,
        decided_at: new Date(),
      };
    },
  } as unknown as ApprovalService;

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
    "approval:request" as const,
    "run:approve_expensive" as const,
  ]),
};

interface BundleOpts {
  authed?: boolean;
  approvalRequestAllowed?: boolean;
  approvalDecideAllowed?: boolean;
  /** When set, the L2.9 mock middleware throws a SecureCoreError. */
  highRiskRejectsWith?: SecureCoreError;
  /** Out-param: records the action passed to the L2.9 factory. */
  factoryCalls?: { action: HighRiskAction | null };
  /** Out-param: records the consumeToken-style record that L2.9 would normally pass. */
  highRiskCalls?: {
    actionAtCall: HighRiskAction | null;
    invocations: number;
  };
}

/**
 * Build a passthrough middleware bundle. Each pre-bound middleware is
 * a NamedMiddleware whose handler pre-populates the request fields
 * its real counterpart would set; the L2.9 factory is recorded so
 * test #5 can assert the action it was bound with.
 */
function makeMiddlewareBundle(opts: BundleOpts): ApprovalRoutesMiddleware {
  const wrap = (
    name:
      | "requireAuth"
      | "enforceCsrfForStateChange"
      | "attachAuditActor"
      | "loadWorkspace"
      | "enforceUniformNotFound"
      | "requireWorkspaceMembership"
      | "requireApprovalRequestCapability"
      | "requireApprovalDecideCapability",
  ): NamedMiddleware => ({
    name:
      name === "requireApprovalRequestCapability"
        ? "requireCapability"
        : name === "requireApprovalDecideCapability"
          ? "requireCapability"
          : name,
    handler: async (req) => {
      if (name === "requireAuth") {
        if (opts.authed === false) {
          throw new SecureCoreError("UNAUTHENTICATED", "no auth.");
        }
        req.auth = baseAuth;
      }
      if (name === "attachAuditActor") req.audit = baseAudit;
      if (name === "loadWorkspace") req.workspace = baseWorkspace;
      if (name === "requireWorkspaceMembership") {
        req.membership = baseMembership;
      }
      if (
        name === "requireApprovalRequestCapability" &&
        opts.approvalRequestAllowed === false
      ) {
        throw new SecureCoreError("PERMISSION_DENIED", "no approval:request.");
      }
      if (
        name === "requireApprovalDecideCapability" &&
        opts.approvalDecideAllowed === false
      ) {
        throw new SecureCoreError(
          "PERMISSION_DENIED",
          "no decide capability.",
        );
      }
    },
  });

  const factoryCalls = opts.factoryCalls;
  const highRiskCalls = opts.highRiskCalls;
  const requireApprovalIfHighRiskFactory = (
    action: HighRiskAction,
  ): NamedMiddleware => {
    if (factoryCalls !== undefined) factoryCalls.action = action;
    return {
      name: "requireApprovalIfHighRisk",
      handler: async (req: FastifyRequest) => {
        if (highRiskCalls !== undefined) {
          highRiskCalls.actionAtCall = action;
          highRiskCalls.invocations += 1;
        }
        if (opts.highRiskRejectsWith !== undefined) {
          throw opts.highRiskRejectsWith;
        }
        // Simulate L2.9 success: attach the consumed-token shape the
        // approve handler reads from `req.approvalToken`.
        (
          req as FastifyRequest & {
            approvalToken?: {
              requestRow: { id: string; status: string };
            };
          }
        ).approvalToken = {
          requestRow: { id: VALID_REQ, status: "approved" },
        };
      },
    };
  };

  return {
    requireAuth: wrap("requireAuth"),
    enforceCsrfForStateChange: wrap("enforceCsrfForStateChange"),
    attachAuditActor: wrap("attachAuditActor"),
    loadWorkspace: wrap("loadWorkspace"),
    enforceUniformNotFound: wrap("enforceUniformNotFound"),
    requireWorkspaceMembership: wrap("requireWorkspaceMembership"),
    requireApprovalRequestCapability: wrap("requireApprovalRequestCapability"),
    requireApprovalDecideCapability: wrap("requireApprovalDecideCapability"),
    requireApprovalIfHighRiskFactory,
  };
}

function buildApp(
  service: ApprovalService,
  mw: ApprovalRoutesMiddleware,
  action: HighRiskAction = "expensive_run",
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
  app.register(approvalRoutes, { service, auditLogger, mw, action });
  return app;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("L4.6 — approval-request routes", () => {
  let stub: ReturnType<typeof makeStubService>;

  beforeEach(() => {
    stub = makeStubService();
  });

  it("POST /approval-requests creates with valid body", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests`,
      payload: {
        object_type: "capsule",
        object_id: "cap-1",
        requested_action: "expensive_run",
      },
    });
    expect(r.statusCode).toBe(201);
    expect(stub.calls.requestApproval[0]).toMatchObject({
      workspaceId: VALID_WS,
      objectType: "capsule",
      objectId: "cap-1",
      requestedAction: "expensive_run",
      requestedBy: ACTOR,
      requestedByAgent: false,
    });
  });

  it("POST /approval-requests rejects missing required fields (Ajv)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests`,
      payload: { object_type: "capsule" },
    });
    expect(r.statusCode).toBe(400);
    expect(stub.calls.requestApproval).toHaveLength(0);
  });

  it("POST /approval-requests rejects extra body fields (additionalProperties: false)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests`,
      payload: {
        object_type: "capsule",
        object_id: "cap-1",
        requested_action: "expensive_run",
        actor_user_id: "evil",
      },
    });
    expect(r.statusCode).toBe(400);
    expect(stub.calls.requestApproval).toHaveLength(0);
  });

  it("POST /approval-requests refused without approval:request capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ approvalRequestAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests`,
      payload: {
        object_type: "capsule",
        object_id: "cap-1",
        requested_action: "expensive_run",
      },
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.requestApproval).toHaveLength(0);
  });

  it("POST /:id/approve routes through the L2.9 mw with the action it was bound with", async () => {
    const factoryCalls = { action: null as HighRiskAction | null };
    const highRiskCalls = {
      actionAtCall: null as HighRiskAction | null,
      invocations: 0,
    };
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ factoryCalls, highRiskCalls }),
      "hpc_submission",
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests/${VALID_REQ}/approve`,
      headers: { "x-approval-token": "tok-raw" },
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(factoryCalls.action).toBe("hpc_submission");
    expect(highRiskCalls.invocations).toBe(1);
    expect(highRiskCalls.actionAtCall).toBe("hpc_submission");
  });

  it("POST /:id/approve refused when L2.9 mw rejects (e.g. missing token)", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({
        highRiskRejectsWith: new SecureCoreError(
          "APPROVAL_REQUIRED",
          "Approval token required for this action.",
        ),
      }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests/${VALID_REQ}/approve`,
      payload: {},
    });
    expect(r.statusCode).toBe(403);
  });

  it("POST /:id/deny calls ApprovalService.denyRequest with the actor user id from req.auth", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests/${VALID_REQ}/deny`,
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(stub.calls.denyRequest[0]).toMatchObject({
      approvalRequestId: VALID_REQ,
      decidedBy: ACTOR,
    });
  });

  it("POST /:id/deny refused without the decide capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ approvalDecideAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests/${VALID_REQ}/deny`,
      payload: {},
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.denyRequest).toHaveLength(0);
  });

  it("Non-UUID approvalRequestId in path → 404 (deny)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests/not-a-uuid/deny`,
      payload: {},
    });
    expect(r.statusCode).toBe(404);
    expect(stub.calls.denyRequest).toHaveLength(0);
  });

  it("Service throw APPROVAL_TOKEN_REUSED on approve is re-thrown as 403", async () => {
    // Make the L2.9 mw simulate the service raising a token-reused error.
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({
        highRiskRejectsWith: new SecureCoreError(
          "APPROVAL_TOKEN_REUSED",
          "Approval token has already been consumed.",
        ),
      }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/approval-requests/${VALID_REQ}/approve`,
      headers: { "x-approval-token": "tok-raw" },
      payload: {},
    });
    expect(r.statusCode).toBe(403);
  });
});

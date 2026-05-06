/**
 * L2.9 — requireApprovalIfHighRisk middleware tests.
 *
 * Pure-logic: ApprovalService is a stub so no DB is required. Covers
 * factory-time validation, the v4 §16.1 transport rules (header only —
 * URL/path/query refused), missing-token rejection with audit, the
 * §13 capability-map binding, and pass-through on success.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

import { requireApprovalIfHighRisk } from "../../src/middleware/requireApprovalIfHighRisk.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { MIDDLEWARE_ORDER } from "../../src/middleware/compose.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import {
  SecureCoreError,
  ApprovalTokenInvalidError,
} from "../../src/errors/shapes.js";
import type {
  ApprovalRequestRow,
  ApprovalService,
  ApprovalTokenRow,
  ConsumeTokenOptions,
} from "../../src/approvals/service.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type {
  AuditContext,
  AuthContext,
  MembershipContext,
} from "../../src/middleware/types.js";

interface AuditCall {
  action: string;
  result: string;
  metadata?: Record<string, unknown>;
}

function makeStubAuditLogger(): {
  logger: AuditLogger;
  calls: AuditCall[];
} {
  const calls: AuditCall[] = [];
  const logger = {
    async write(input: {
      action: string;
      result: string;
      metadata?: Record<string, unknown>;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        metadata: input.metadata,
      });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

interface StubServiceState {
  lastConsume?: ConsumeTokenOptions;
  /** Override per test. Default returns a successful row pair. */
  onConsume?: (
    opts: ConsumeTokenOptions,
  ) => Promise<{ requestRow: ApprovalRequestRow; tokenRow: ApprovalTokenRow }>;
}

function makeStubApprovalService(state: StubServiceState): ApprovalService {
  return {
    async consumeToken(opts: ConsumeTokenOptions) {
      state.lastConsume = opts;
      if (state.onConsume) return state.onConsume(opts);
      return {
        requestRow: {
          id: opts.expectedRequestId,
          workspace_id: "ws-1",
          object_type: "tool",
          object_id: "obj-1",
          requested_action: opts.expectedAction,
          requested_by: "user-r",
          requested_by_agent: false,
          status: "pending",
          decided_by: null,
          decided_at: null,
          created_at: new Date(),
        } satisfies ApprovalRequestRow,
        tokenRow: {
          id: "tok-1",
          workspace_id: "ws-1",
          approval_request_id: opts.expectedRequestId,
          token_hash: "h",
          token_context_hash: "c",
          approver_user_id: opts.consumerUserId,
          approver_role_id: null,
          created_by: "user-r",
          created_at: new Date(),
          expires_at: new Date(Date.now() + 60_000),
          used_at: null,
          revoked_at: null,
        } satisfies ApprovalTokenRow,
      };
    },
  } as unknown as ApprovalService;
}

function preAttachContext(req: {
  auth: AuthContext;
  audit: AuditContext;
  membership: MembershipContext;
  workspace: { id: string; name: string; createdBy: string };
}) {
  return async (
    request: import("fastify").FastifyRequest,
  ): Promise<void> => {
    request.auth = req.auth;
    request.audit = req.audit;
    request.membership = req.membership;
    request.workspace = req.workspace;
  };
}

const baseAuth: AuthContext = {
  userId: "user-c",
  sessionId: "sess-1",
  actorType: "human",
  assuranceLevel: "aal2",
};
const baseAudit: AuditContext = {
  actorUserId: "user-c",
  actorType: "human",
  requestId: "req-test",
};
const baseMembership: MembershipContext = {
  workspaceId: "ws-1",
  userId: "user-c",
  roleId: "role-reviewer-uuid",
  roleName: "Reviewer",
  capabilities: new Set(),
};
const baseWorkspace = { id: "ws-1", name: "ws", createdBy: "user-r" };

function buildApp(
  service: ApprovalService,
  auditLogger: AuditLogger,
  action: import("../../src/config/high_risk_actions.js").HighRiskAction,
): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requireRequestId);
  app.setErrorHandler((err, req, reply) => {
    const mapped = toHttpResponse(
      err instanceof SecureCoreError ? err : err,
      req.requestId ?? "unknown",
    );
    reply.code(mapped.status).send(mapped.body);
  });
  const mw = requireApprovalIfHighRisk({
    action,
    approvalService: service,
    auditLogger,
  });
  app.post(
    "/workspaces/:workspaceId/approval-requests/:approvalRequestId/probe",
    {
      preHandler: [
        preAttachContext({
          auth: baseAuth,
          audit: baseAudit,
          membership: baseMembership,
          workspace: baseWorkspace,
        }),
        mw.handler,
      ],
    },
    async (req) => {
      const consumed = (
        req as import("fastify").FastifyRequest & {
          approvalToken?: { tokenRow: { id: string } };
        }
      ).approvalToken;
      return { ok: true, tokenId: consumed?.tokenRow.id ?? null };
    },
  );
  return app;
}

describe("requireApprovalIfHighRisk — L2.9", () => {
  let auditStub: ReturnType<typeof makeStubAuditLogger>;
  let serviceState: StubServiceState;
  let service: ApprovalService;

  beforeEach(() => {
    auditStub = makeStubAuditLogger();
    serviceState = {};
    service = makeStubApprovalService(serviceState);
  });

  it("factory throws synchronously when action is not in HIGH_RISK_ACTIONS", () => {
    expect(() =>
      requireApprovalIfHighRisk({
        action: "not-a-real-action" as never,
        approvalService: service,
        auditLogger: auditStub.logger,
      }),
    ).toThrow(/not a high-risk action/);
  });

  it("missing X-Approval-Token header → APPROVAL_REQUIRED + approval.required audit (token_missing)", async () => {
    const app = buildApp(service, auditStub.logger, "trusted_module_promotion");
    const r = await app.inject({
      method: "POST",
      url: "/workspaces/ws-1/approval-requests/req-1/probe",
    });
    expect(r.statusCode).toBe(403);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("APPROVAL_REQUIRED");
    expect(auditStub.calls).toHaveLength(1);
    expect(auditStub.calls[0].action).toBe("approval.required");
    expect(auditStub.calls[0].result).toBe("denied");
    expect(auditStub.calls[0].metadata?.denied_reason).toBe("token_missing");
    expect(auditStub.calls[0].metadata?.capability).toBe(
      "tool:approve_promotion",
    );
  });

  it("token in query string → APPROVAL_REQUIRED + token_in_url_or_query audit", async () => {
    const app = buildApp(service, auditStub.logger, "trusted_module_promotion");
    const r = await app.inject({
      method: "POST",
      url: "/workspaces/ws-1/approval-requests/req-1/probe?approval_token=t",
      headers: { "x-approval-token": "header-token" },
    });
    expect(r.statusCode).toBe(403);
    expect(auditStub.calls[0].metadata?.denied_reason).toBe(
      "token_in_url_or_query",
    );
  });

  it("token in URL path component → APPROVAL_REQUIRED", async () => {
    const app = buildApp(service, auditStub.logger, "trusted_module_promotion");
    const r = await app.inject({
      method: "POST",
      url: "/workspaces/ws-1/approval-requests/req-approval-token-9/probe",
      headers: { "x-approval-token": "header-token" },
    });
    expect(r.statusCode).toBe(403);
    expect(auditStub.calls[0].metadata?.denied_reason).toBe(
      "token_in_url_or_query",
    );
  });

  it("happy path: header present, service returns row pair → handler sees req.approvalToken", async () => {
    const app = buildApp(service, auditStub.logger, "trusted_module_promotion");
    const r = await app.inject({
      method: "POST",
      url: "/workspaces/ws-1/approval-requests/req-1/probe",
      headers: { "x-approval-token": "raw-token" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; tokenId: string };
    expect(body).toEqual({ ok: true, tokenId: "tok-1" });
    expect(serviceState.lastConsume?.expectedRequestId).toBe("req-1");
    expect(serviceState.lastConsume?.expectedAction).toBe("trusted_module_promotion");
    expect(serviceState.lastConsume?.consumerUserId).toBe("user-c");
    expect(serviceState.lastConsume?.consumerRoleIds).toEqual([
      "role-reviewer-uuid",
    ]);
    // Service emits its own granted/denied audit; this middleware is silent
    // on the success path.
    expect(auditStub.calls).toHaveLength(0);
  });

  it("service throws APPROVAL_TOKEN_REUSED → middleware re-throws unchanged", async () => {
    serviceState.onConsume = async () => {
      throw new SecureCoreError(
        "APPROVAL_TOKEN_REUSED",
        "Token already used.",
      );
    };
    const app = buildApp(service, auditStub.logger, "trusted_module_promotion");
    const r = await app.inject({
      method: "POST",
      url: "/workspaces/ws-1/approval-requests/req-1/probe",
      headers: { "x-approval-token": "raw-token" },
    });
    expect(r.statusCode).toBe(403);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("APPROVAL_TOKEN_REUSED");
    // Service owns the audit on the consume failure path; middleware adds
    // none beyond that.
    expect(auditStub.calls).toHaveLength(0);
  });

  it("service throws APPROVAL_TOKEN_INVALID → re-thrown as 403", async () => {
    serviceState.onConsume = async () => {
      throw new ApprovalTokenInvalidError("Token not found.");
    };
    const app = buildApp(service, auditStub.logger, "trusted_module_promotion");
    const r = await app.inject({
      method: "POST",
      url: "/workspaces/ws-1/approval-requests/req-1/probe",
      headers: { "x-approval-token": "raw-token" },
    });
    expect(r.statusCode).toBe(403);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("APPROVAL_TOKEN_INVALID");
  });

  it("requireApprovalIfHighRisk is the last slot in MIDDLEWARE_ORDER", () => {
    expect(MIDDLEWARE_ORDER[MIDDLEWARE_ORDER.length - 1]).toBe(
      "requireApprovalIfHighRisk",
    );
  });

  it("attaches the consumed token + request rows to req.approvalToken", async () => {
    const app = buildApp(service, auditStub.logger, "hpc_submission");
    // Use the run-approval action to confirm the capability map binding.
    const r = await app.inject({
      method: "POST",
      url: "/workspaces/ws-1/approval-requests/req-2/probe",
      headers: { "x-approval-token": "tok" },
    });
    expect(r.statusCode).toBe(200);
    expect(serviceState.lastConsume?.expectedAction).toBe("hpc_submission");
  });
});

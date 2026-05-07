/**
 * L4.10 — operator route tests.
 *
 * Pure-logic. Stubbed `OperatorService` + passthrough middleware
 * bundle (each middleware pre-populates the request fields its real
 * counterpart would set). DB-bound behavior — paired audit/operator
 * row hash chaining + tx atomicity — is unit-tested at the service
 * level via in-memory writers.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  operatorRoutes,
  type OperatorRoutesMiddleware,
} from "../../src/routes/operator.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import type { NamedMiddleware } from "../../src/middleware/compose.js";
import type {
  AuditContext,
  AuthContext,
} from "../../src/middleware/types.js";
import type {
  EnterInvestigationArgs,
  EnterInvestigationResult,
  ExecuteRemediationArgs,
  ExecuteRemediationResult,
  ListAuditEventsCrossWorkspaceArgs,
  OperatorService,
} from "../../src/operator/service.js";
import type {
  AuditEventOutputRow,
  ListAuditEventsResult,
} from "../../src/audit/readService.js";
import type { AuditLogger } from "../../src/audit/logger.js";

const VALID_WS = "11111111-1111-4111-8111-111111111111";
const VALID_TARGET = "44444444-4444-4444-8444-444444444444";
const VALID_APPROVAL_REQ = "55555555-5555-4555-8555-555555555555";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const auditLogger = { write: async () => {} } as unknown as AuditLogger;

interface ServiceCalls {
  list: ListAuditEventsCrossWorkspaceArgs[];
  investigate: EnterInvestigationArgs[];
  remediate: ExecuteRemediationArgs[];
}

function makeStubService(): {
  service: OperatorService;
  calls: ServiceCalls;
} {
  const calls: ServiceCalls = {
    list: [],
    investigate: [],
    remediate: [],
  };

  const sampleRow: AuditEventOutputRow = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    actor_user_id: ACTOR,
    actor_type: "human",
    action: "capsule.created",
    object_type: "capsule",
    object_id: null,
    result: "succeeded",
    request_id: "req-prior",
    created_at: "2025-01-01T00:00:00.000Z",
    metadata: {},
  };

  const service = {
    async listAuditEventsCrossWorkspace(
      args: ListAuditEventsCrossWorkspaceArgs,
    ): Promise<ListAuditEventsResult> {
      calls.list.push(args);
      return { rows: [sampleRow], nextCursor: null };
    },
    async enterInvestigation(
      args: EnterInvestigationArgs,
    ): Promise<EnterInvestigationResult> {
      calls.investigate.push(args);
      return {
        sessionId: "ssssssss-ssss-4sss-8sss-ssssssssssss".replace(/s/g, "1"),
        expiresAt: new Date(Date.now() + args.ttlSeconds * 1000).toISOString(),
      };
    },
    async executeRemediation(
      args: ExecuteRemediationArgs,
    ): Promise<ExecuteRemediationResult> {
      calls.remediate.push(args);
      return {
        action: args.action,
        targetId: args.targetId,
        auditEventId: "auditid01-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        operatorEventId: "opidopid-oooo-4ooo-8ooo-oooooooooooo".replace(
          /o/g,
          "1",
        ),
      };
    },
  } as unknown as OperatorService;

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

interface BundleOpts {
  authed?: boolean;
  auditReadAllowed?: boolean;
  investigateAllowed?: boolean;
  remediateAllowed?: boolean;
  approvalAccepted?: boolean;
  approvalCalls?: { invoked: number };
}

function makeMiddlewareBundle(opts: BundleOpts): OperatorRoutesMiddleware {
  const stub = (
    label:
      | "requireAuth"
      | "enforceCsrfForStateChange"
      | "attachAuditActor"
      | "auditRead"
      | "investigate"
      | "remediate",
  ): NamedMiddleware => ({
    name:
      label === "auditRead" ||
      label === "investigate" ||
      label === "remediate"
        ? "requireCapability"
        : label,
    handler: async (req: FastifyRequest) => {
      if (label === "requireAuth") {
        if (opts.authed === false) {
          throw new SecureCoreError("UNAUTHENTICATED", "no auth.");
        }
        req.auth = baseAuth;
      }
      if (label === "attachAuditActor") req.audit = baseAudit;
      if (label === "auditRead" && opts.auditReadAllowed === false) {
        throw new SecureCoreError(
          "PERMISSION_DENIED",
          "no platform:audit_read.",
        );
      }
      if (label === "investigate" && opts.investigateAllowed === false) {
        throw new SecureCoreError(
          "PERMISSION_DENIED",
          "no platform:incident_investigate.",
        );
      }
      if (label === "remediate" && opts.remediateAllowed === false) {
        throw new SecureCoreError(
          "PERMISSION_DENIED",
          "no platform:incident_remediate.",
        );
      }
    },
  });

  const requireApprovalIfHighRiskFactory = (): NamedMiddleware => ({
    name: "requireApprovalIfHighRisk",
    handler: async (req: FastifyRequest) => {
      if (opts.approvalCalls !== undefined) {
        opts.approvalCalls.invoked += 1;
      }
      const headerName = "x-approval-token";
      const presented = req.headers[headerName];
      if (presented === undefined || presented === "" || presented === null) {
        throw new SecureCoreError(
          "APPROVAL_REQUIRED",
          "Approval token missing.",
        );
      }
      if (opts.approvalAccepted === false) {
        throw new SecureCoreError(
          "APPROVAL_REQUIRED",
          "Approval token rejected.",
        );
      }
    },
  });

  return {
    requireAuth: stub("requireAuth"),
    enforceCsrfForStateChange: stub("enforceCsrfForStateChange"),
    attachAuditActor: stub("attachAuditActor"),
    requireOperatorAuditRead: stub("auditRead"),
    requireOperatorIncidentInvestigate: stub("investigate"),
    requireOperatorIncidentRemediate: stub("remediate"),
    requireApprovalIfHighRiskFactory,
  };
}

function buildApp(
  service: OperatorService,
  mw: OperatorRoutesMiddleware,
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
  app.register(operatorRoutes, { service, auditLogger, mw });
  return app;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("L4.10 — operator routes", () => {
  let stub: ReturnType<typeof makeStubService>;

  beforeEach(() => {
    stub = makeStubService();
  });

  it("GET /operator/audit-events with platform:audit_read returns the list", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/operator/audit-events?workspace_id=${VALID_WS}`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { events: AuditEventOutputRow[] };
    expect(body.events).toHaveLength(1);
    // Service was called with the workspace filter + actor identity
    // derived from req.auth (NOT from req.body / query).
    expect(stub.calls.list).toHaveLength(1);
    expect(stub.calls.list[0].workspaceId).toBe(VALID_WS);
    expect(stub.calls.list[0].actorUserId).toBe(ACTOR);
  });

  it("GET /operator/audit-events without capability → 403, no service call", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ auditReadAllowed: false }),
    );
    const r = await app.inject({
      method: "GET",
      url: `/operator/audit-events`,
    });
    expect(r.statusCode).toBe(403);
    // No paired-emission attempt: capability check ran BEFORE the
    // service, so no operator_events row was written.
    expect(stub.calls.list).toHaveLength(0);
  });

  it("GET /operator/audit-events with no workspace_id walks all workspaces", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/operator/audit-events`,
    });
    expect(r.statusCode).toBe(200);
    expect(stub.calls.list).toHaveLength(1);
    expect(stub.calls.list[0].workspaceId).toBeUndefined();
  });

  it("POST /operator/incident/:ws/investigate happy path", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ approvalAccepted: true }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/${VALID_WS}/investigate`,
      payload: {
        reason: "looking into anomaly",
        ttl_seconds: 3600,
        approval_request_id: VALID_APPROVAL_REQ,
      },
      headers: {
        "x-approval-token": "raw-approval-token-from-out-of-band-channel",
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { session_id: string; expires_at: string };
    expect(body.session_id).toBeTypeOf("string");
    expect(body.expires_at).toBeTypeOf("string");
    expect(stub.calls.investigate).toHaveLength(1);
    expect(stub.calls.investigate[0].targetWorkspaceId).toBe(VALID_WS);
    expect(stub.calls.investigate[0].reason).toBe("looking into anomaly");
    expect(stub.calls.investigate[0].ttlSeconds).toBe(3600);
    expect(stub.calls.investigate[0].actorUserId).toBe(ACTOR);
  });

  it("POST /operator/incident/:ws/investigate without capability → 403", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ investigateAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/${VALID_WS}/investigate`,
      payload: {
        reason: "x",
        ttl_seconds: 3600,
        approval_request_id: VALID_APPROVAL_REQ,
      },
      headers: { "x-approval-token": "valid-token" },
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.investigate).toHaveLength(0);
  });

  it("POST /operator/incident/:ws/investigate writes paired rows (service receives required fields)", async () => {
    // The handler delegates the actual paired emission to
    // OperatorService.enterInvestigation; that the service was called
    // with a non-empty reason + ttl + workspaceId is the route's
    // contribution to the pairing invariant. Service-level paired-row
    // tests live next to the service.
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ approvalAccepted: true }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/${VALID_WS}/investigate`,
      payload: {
        reason: "audit anomaly",
        ttl_seconds: 7200,
        approval_request_id: VALID_APPROVAL_REQ,
      },
      headers: { "x-approval-token": "valid-token" },
    });
    expect(r.statusCode).toBe(201);
    expect(stub.calls.investigate).toHaveLength(1);
    const call = stub.calls.investigate[0];
    expect(call.targetWorkspaceId).toBe(VALID_WS);
    expect(call.reason.length).toBeGreaterThan(0);
    expect(call.ttlSeconds).toBeGreaterThan(0);
    expect(call.actorUserId).toBe(ACTOR);
    expect(call.requestId.length).toBeGreaterThan(0);
  });

  it("POST /operator/incident/:ws/remediate without approval token → 403, no service call", async () => {
    const calls = { invoked: 0 };
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ approvalCalls: calls }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/${VALID_WS}/remediate`,
      payload: {
        reason: "containment",
        action: "delete_session",
        target_id: VALID_TARGET,
        approval_request_id: VALID_APPROVAL_REQ,
      },
    });
    expect(r.statusCode).toBe(403);
    expect(calls.invoked).toBe(1);
    // Service is not invoked when approval rejects.
    expect(stub.calls.remediate).toHaveLength(0);
  });

  it("POST /operator/incident/:ws/investigate without approval token → 403", async () => {
    const calls = { invoked: 0 };
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ approvalCalls: calls }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/${VALID_WS}/investigate`,
      payload: {
        reason: "audit anomaly",
        ttl_seconds: 3600,
        approval_request_id: VALID_APPROVAL_REQ,
      },
    });
    expect(r.statusCode).toBe(403);
    expect(calls.invoked).toBe(1);
    expect(stub.calls.investigate).toHaveLength(0);
  });

  it("POST /operator/incident/:ws/remediate with valid approval succeeds", async () => {
    const calls = { invoked: 0 };
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ approvalAccepted: true, approvalCalls: calls }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/${VALID_WS}/remediate`,
      payload: {
        reason: "containment",
        action: "delete_session",
        target_id: VALID_TARGET,
        approval_request_id: VALID_APPROVAL_REQ,
      },
      headers: {
        "x-approval-token": "raw-approval-token-from-out-of-band-channel",
      },
    });
    expect(r.statusCode).toBe(200);
    expect(calls.invoked).toBe(1);
    const body = r.json() as {
      action: string;
      target_id: string;
      audit_event_id: string;
      operator_event_id: string;
    };
    expect(body.action).toBe("delete_session");
    expect(body.target_id).toBe(VALID_TARGET);
    expect(body.audit_event_id.length).toBeGreaterThan(0);
    expect(body.operator_event_id.length).toBeGreaterThan(0);
    expect(stub.calls.remediate).toHaveLength(1);
    expect(stub.calls.remediate[0].targetWorkspaceId).toBe(VALID_WS);
    expect(stub.calls.remediate[0].targetId).toBe(VALID_TARGET);
    expect(stub.calls.remediate[0].action).toBe("delete_session");
  });

  it("POST /operator/incident/:ws/remediate without capability → 403 before approval check", async () => {
    const calls = { invoked: 0 };
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({
        remediateAllowed: false,
        approvalCalls: calls,
      }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/${VALID_WS}/remediate`,
      payload: {
        reason: "x",
        action: "lock_capsule",
        target_id: VALID_TARGET,
        approval_request_id: VALID_APPROVAL_REQ,
      },
      headers: { "x-approval-token": "valid-token" },
    });
    expect(r.statusCode).toBe(403);
    // Capability check fires BEFORE L2.9 in the §6.2 chain.
    expect(calls.invoked).toBe(0);
    expect(stub.calls.remediate).toHaveLength(0);
  });

  it("POST /operator/incident/:ws/investigate with non-UUID workspaceId → 404", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/not-a-uuid/investigate`,
      payload: {
        reason: "x",
        ttl_seconds: 3600,
        approval_request_id: VALID_APPROVAL_REQ,
      },
      headers: { "x-approval-token": "valid-token" },
    });
    expect(r.statusCode).toBe(404);
    expect(stub.calls.investigate).toHaveLength(0);
  });

  it("POST /operator/incident/:ws/investigate rejects ttl_seconds > 8h", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/${VALID_WS}/investigate`,
      payload: {
        reason: "x",
        ttl_seconds: 9 * 60 * 60,
        approval_request_id: VALID_APPROVAL_REQ,
      },
    });
    expect(r.statusCode).toBe(400);
    expect(stub.calls.investigate).toHaveLength(0);
  });

  it("POST /operator/incident/:ws/remediate rejects unknown action enum", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/operator/incident/${VALID_WS}/remediate`,
      payload: {
        reason: "x",
        action: "format_disk",
        target_id: VALID_TARGET,
        approval_request_id: VALID_APPROVAL_REQ,
      },
      headers: { "x-approval-token": "valid-token" },
    });
    expect(r.statusCode).toBe(400);
    expect(stub.calls.remediate).toHaveLength(0);
  });

  it("GET /operator/audit-events refuses without auth → 401", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ authed: false }),
    );
    const r = await app.inject({
      method: "GET",
      url: `/operator/audit-events`,
    });
    expect(r.statusCode).toBe(401);
  });
});

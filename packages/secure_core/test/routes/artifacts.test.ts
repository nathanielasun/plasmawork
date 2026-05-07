/**
 * L4.5 — artifact route tests.
 *
 * Pure-logic. Stubbed `ArtifactService` + passthrough middleware
 * bundle. The L2.9 `requireApprovalIfHighRisk` factory is also a stub
 * that records the action it was bound with and either succeeds (sets
 * `req.approvalToken`) or rejects (when `highRiskRejectsWith` is set).
 *
 * Mirrors the L4.6 approvals.test.ts shape exactly. DB-bound behavior
 * (real SsrfGuard + real StorageReservationService) is pinned by the
 * service's own DB-gated tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  artifactRoutes,
  type ArtifactRoutesMiddleware,
} from "../../src/routes/artifacts.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import {
  InputInvalidError,
  NotFoundError,
  QuotaExceededError,
  SecureCoreError,
} from "../../src/errors/shapes.js";
import type { HighRiskAction } from "../../src/config/high_risk_actions.js";
import type { NamedMiddleware } from "../../src/middleware/compose.js";
import type {
  ArtifactRow,
  ArtifactService,
  ListArtifactsOptions,
  ListArtifactsResult,
  RequestExportOptions,
  RequestExportResult,
} from "../../src/artifacts/service.js";
import type {
  AuditContext,
  AuthContext,
  MembershipContext,
  WorkspaceContext,
} from "../../src/middleware/types.js";

const VALID_WS = "11111111-1111-4111-8111-111111111111";
const VALID_ART = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const FAKE_RESERVATION = "44444444-4444-4444-8444-444444444444";
const FAKE_EXPORT = "55555555-5555-4555-8555-555555555555";

// -------------------------------------------------------------------
// Stubs
// -------------------------------------------------------------------

interface ServiceCalls {
  listArtifacts: Array<{ workspaceId: string; opts: ListArtifactsOptions }>;
  getArtifactOrThrow: Array<{ workspaceId: string; artifactId: string }>;
  requestExport: RequestExportOptions[];
}

interface StubBehavior {
  /** When set, requestExport throws this error before recording. */
  requestExportRejectsWith?: SecureCoreError;
  /** When set, getArtifactOrThrow throws NotFoundError. */
  getArtifactRejects?: boolean;
}

function makeStubService(behavior: StubBehavior = {}): {
  service: ArtifactService;
  calls: ServiceCalls;
} {
  const calls: ServiceCalls = {
    listArtifacts: [],
    getArtifactOrThrow: [],
    requestExport: [],
  };

  const baseRow: ArtifactRow = {
    id: VALID_ART,
    workspace_id: VALID_WS,
    artifact_type: "report",
    storage_path: "ws/art-1",
    content_hash: "sha256:deadbeef",
    created_by: ACTOR,
    created_at: new Date("2026-01-01T00:00:00Z"),
  };

  const service = {
    async listArtifacts(
      workspaceId: string,
      opts: ListArtifactsOptions = {},
    ): Promise<ListArtifactsResult> {
      calls.listArtifacts.push({ workspaceId, opts });
      return { rows: [baseRow], nextCursor: null };
    },
    async getArtifactOrThrow(
      workspaceId: string,
      artifactId: string,
    ): Promise<ArtifactRow> {
      calls.getArtifactOrThrow.push({ workspaceId, artifactId });
      if (behavior.getArtifactRejects === true) {
        throw new NotFoundError("Not found.");
      }
      return { ...baseRow, id: artifactId, workspace_id: workspaceId };
    },
    async requestExport(opts: RequestExportOptions): Promise<RequestExportResult> {
      if (behavior.requestExportRejectsWith !== undefined) {
        throw behavior.requestExportRejectsWith;
      }
      calls.requestExport.push(opts);
      return {
        exportId: FAKE_EXPORT,
        reservationId: FAKE_RESERVATION,
        expiresAt: new Date("2026-01-01T01:00:00Z"),
      };
    },
  } as unknown as ArtifactService;

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
  capabilities: new Set(["artifact:read" as const, "artifact:export" as const]),
};

interface BundleOpts {
  authed?: boolean;
  artifactReadAllowed?: boolean;
  /** When set, the L2.9 mock middleware throws a SecureCoreError. */
  highRiskRejectsWith?: SecureCoreError;
  /** Out-param: records the action passed to the L2.9 factory. */
  factoryCalls?: { action: HighRiskAction | null };
  /** Out-param: counts L2.9 invocations per request. */
  highRiskCalls?: {
    actionAtCall: HighRiskAction | null;
    invocations: number;
  };
}

function makeMiddlewareBundle(opts: BundleOpts): ArtifactRoutesMiddleware {
  const wrap = (
    name:
      | "requireAuth"
      | "enforceCsrfForStateChange"
      | "attachAuditActor"
      | "loadWorkspace"
      | "enforceUniformNotFound"
      | "requireWorkspaceMembership"
      | "enforceArtifactWorkspaceScope"
      | "requireArtifactRead",
  ): NamedMiddleware => ({
    name:
      name === "requireArtifactRead"
        ? "requireCapability"
        : name === "enforceArtifactWorkspaceScope"
          ? "enforceObjectWorkspaceScope"
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
        name === "requireArtifactRead" &&
        opts.artifactReadAllowed === false
      ) {
        throw new SecureCoreError("PERMISSION_DENIED", "no artifact:read.");
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
            approvalToken?: { requestRow: { id: string; status: string } };
          }
        ).approvalToken = {
          requestRow: { id: "approved-req", status: "approved" },
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
    enforceArtifactWorkspaceScope: wrap("enforceArtifactWorkspaceScope"),
    requireArtifactRead: wrap("requireArtifactRead"),
    requireApprovalIfHighRiskFactory,
  };
}

function buildApp(
  service: ArtifactService,
  mw: ArtifactRoutesMiddleware,
  maxExportBytes?: number,
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
  app.register(artifactRoutes, {
    service,
    mw,
    ...(maxExportBytes !== undefined ? { maxExportBytes } : {}),
  });
  return app;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("L4.5 — artifact routes", () => {
  let stub: ReturnType<typeof makeStubService>;

  beforeEach(() => {
    stub = makeStubService();
  });

  it("GET /artifacts lists for the workspace", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/artifacts`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { artifacts: Array<{ id: string }> };
    expect(body.artifacts).toHaveLength(1);
    expect(stub.calls.listArtifacts[0]?.workspaceId).toBe(VALID_WS);
  });

  it("GET /artifacts/:id reads metadata", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/artifacts/${VALID_ART}`,
    });
    expect(r.statusCode).toBe(200);
    expect(stub.calls.getArtifactOrThrow[0]).toMatchObject({
      workspaceId: VALID_WS,
      artifactId: VALID_ART,
    });
  });

  it("GET /artifacts/:id refuses non-UUID artifact id with 404", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/artifacts/not-a-uuid`,
    });
    expect(r.statusCode).toBe(404);
  });

  it("POST /export with valid token routes through L2.9 and succeeds", async () => {
    const factoryCalls = { action: null as HighRiskAction | null };
    const highRiskCalls = {
      actionAtCall: null as HighRiskAction | null,
      invocations: 0,
    };
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ factoryCalls, highRiskCalls }),
    );
    // Force plugin registration to complete so the factory has run.
    await app.ready();
    // The factory is called at registration regardless of whether a
    // request hits the route.
    expect(factoryCalls.action).toBe("artifact_export");

    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/artifacts/${VALID_ART}/export`,
      headers: { "x-approval-token": "tok-1" },
      payload: {
        destination_uri: "https://exports.example.com/bucket/a",
        expected_size_bytes: 1024,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as {
      export_id: string;
      reservation_id: string;
      expires_at: string;
    };
    expect(body.export_id).toBe(FAKE_EXPORT);
    expect(body.reservation_id).toBe(FAKE_RESERVATION);
    expect(highRiskCalls.actionAtCall).toBe("artifact_export");
    expect(highRiskCalls.invocations).toBe(1);
    // The service was called with the parsed bigint and the actor id
    // sourced from req.auth (NOT from req.body — task hard rule).
    expect(stub.calls.requestExport[0]).toMatchObject({
      workspaceId: VALID_WS,
      artifactId: VALID_ART,
      destinationUri: "https://exports.example.com/bucket/a",
      actorUserId: ACTOR,
    });
    expect(stub.calls.requestExport[0]?.expectedSizeBytes).toBe(1024n);
  });

  it("POST /export without an approval token is refused by the L2.9 stub", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({
        highRiskRejectsWith: new SecureCoreError(
          "APPROVAL_REQUIRED",
          "Approval token required.",
        ),
      }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/artifacts/${VALID_ART}/export`,
      payload: {
        destination_uri: "https://exports.example.com/bucket/a",
        expected_size_bytes: 1024,
      },
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.requestExport).toHaveLength(0);
  });

  it("POST /export with private/loopback URL surfaces SSRF refusal as 400", async () => {
    // Service-level rejection — the real SsrfGuard is exercised in the
    // service's own tests; here we assert the route propagates the
    // typed error to the wire.
    const stub2 = makeStubService({
      requestExportRejectsWith: new InputInvalidError("URL host not allowed.", {
        reason: "loopback",
      }),
    });
    const app = buildApp(stub2.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/artifacts/${VALID_ART}/export`,
      headers: { "x-approval-token": "tok-1" },
      payload: {
        destination_uri: "http://127.0.0.1/exfil",
        expected_size_bytes: 1024,
      },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("INPUT_INVALID");
  });

  it("POST /export with size > maxExportBytes raises INPUT_INVALID before the service is called", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}), 4096);
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/artifacts/${VALID_ART}/export`,
      headers: { "x-approval-token": "tok-1" },
      payload: {
        destination_uri: "https://exports.example.com/bucket/a",
        expected_size_bytes: 8192,
      },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("INPUT_INVALID");
    expect(stub.calls.requestExport).toHaveLength(0);
  });

  it("POST /export when quota fails surfaces 429 QUOTA_EXCEEDED", async () => {
    const stub2 = makeStubService({
      requestExportRejectsWith: new QuotaExceededError("Quota limit exceeded.", {
        quota_key: "stored.bytes",
      }),
    });
    const app = buildApp(stub2.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/artifacts/${VALID_ART}/export`,
      headers: { "x-approval-token": "tok-1" },
      payload: {
        destination_uri: "https://exports.example.com/bucket/a",
        expected_size_bytes: 1024,
      },
    });
    expect(r.statusCode).toBe(429);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("QUOTA_EXCEEDED");
  });

  it("POST /export refused without artifact:read capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ artifactReadAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/artifacts/${VALID_ART}/export`,
      headers: { "x-approval-token": "tok-1" },
      payload: {
        destination_uri: "https://exports.example.com/bucket/a",
        expected_size_bytes: 1024,
      },
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.requestExport).toHaveLength(0);
  });

  it("GET /artifacts/:id with non-UUID artifactId returns 404 (uniform per v4 §4.4)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/artifacts/zz`,
    });
    expect(r.statusCode).toBe(404);
    expect(stub.calls.getArtifactOrThrow).toHaveLength(0);
  });

  it("POST /export rejects extra body fields (additionalProperties: false)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/artifacts/${VALID_ART}/export`,
      headers: { "x-approval-token": "tok-1" },
      payload: {
        destination_uri: "https://exports.example.com/bucket/a",
        expected_size_bytes: 1024,
        actor_user_id: "evil",
      },
    });
    expect(r.statusCode).toBe(400);
    expect(stub.calls.requestExport).toHaveLength(0);
  });
});

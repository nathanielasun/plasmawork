/**
 * L4.11 — worker token issuance route tests.
 *
 * Pure-logic. Stubbed `RunRecordSource` + passthrough middleware
 * bundle. The `AuditLogger` is stubbed to capture emitted events so
 * we can assert the raw token NEVER lands in audit metadata (only
 * the hash does).
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";

import {
  workerTokenRoute,
  type WorkerTokenRouteMiddleware,
  type WorkerTokenRouteOptions,
  type RunRecordSource,
  type WorkerTokenRunRecord,
} from "../../src/workers/tokenRoute.js";
import { verifyWorkerToken } from "../../src/workers/tokenIssuer.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type {
  AuthContext,
  AuditContext,
} from "../../src/middleware/types.js";
import type { RunState } from "../../src/runs/stateMachine.js";

const HMAC_KEY = randomBytes(32);

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const WS_ID = "22222222-2222-4222-8222-222222222222";
const CAP_ID = "33333333-3333-4333-8333-333333333333";
const VER_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const ORCHESTRATOR = "66666666-6666-4666-8666-666666666666";

// -------------------------------------------------------------------
// Stubs
// -------------------------------------------------------------------

interface AuditCall {
  action: string;
  result: string;
  actorUserId: string | null;
  actorType: string;
  workspaceId: string | null;
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
      actorUserId: string | null;
      actorType: string;
      workspaceId: string | null;
      metadata?: Record<string, unknown>;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        actorUserId: input.actorUserId,
        actorType: input.actorType,
        workspaceId: input.workspaceId,
        metadata: input.metadata,
      });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

function makeStubRunSource(opts: {
  status?: RunState;
  found?: boolean;
}): RunRecordSource {
  return {
    async fetchById(runId: string): Promise<WorkerTokenRunRecord | null> {
      if (opts.found === false) return null;
      return {
        id: runId,
        workspaceId: WS_ID,
        capsuleId: CAP_ID,
        capsuleVersionId: VER_ID,
        requestedByUserId: USER_ID,
        status: opts.status ?? "running",
      };
    },
  };
}

const baseAuth: AuthContext = {
  userId: ORCHESTRATOR,
  sessionId: "sess-orch",
  actorType: "operator",
  assuranceLevel: "aal2",
};
const baseAudit: AuditContext = {
  actorUserId: ORCHESTRATOR,
  actorType: "operator",
  requestId: "req-test",
};

interface BundleOptions {
  authed?: boolean;
  actorType?: AuthContext["actorType"];
  workerIssueTokenAllowed?: boolean;
}

function makeMiddlewareBundle(opts: BundleOptions): WorkerTokenRouteMiddleware {
  type MwName =
    | "requireAuth"
    | "enforceCsrfForStateChange"
    | "attachAuditActor"
    | "requireWorkerIssueToken";

  const realName = (
    name: MwName,
  ): import("../../src/middleware/compose.js").MiddlewareName => {
    switch (name) {
      case "requireAuth":
        return "requireAuth";
      case "enforceCsrfForStateChange":
        return "enforceCsrfForStateChange";
      case "attachAuditActor":
        return "attachAuditActor";
      case "requireWorkerIssueToken":
        return "requireCapability";
    }
  };

  const wrap = (name: MwName): WorkerTokenRouteMiddleware[MwName] => ({
    name: realName(name),
    handler: async (req) => {
      if (name === "requireAuth") {
        if (opts.authed === false) {
          throw new SecureCoreError("UNAUTHENTICATED", "no auth.");
        }
        req.auth = {
          ...baseAuth,
          actorType: opts.actorType ?? baseAuth.actorType,
        };
        return;
      }
      if (name === "attachAuditActor") {
        req.audit = baseAudit;
        return;
      }
      if (
        name === "requireWorkerIssueToken" &&
        opts.workerIssueTokenAllowed === false
      ) {
        throw new SecureCoreError(
          "PERMISSION_DENIED",
          "no worker:issue_token.",
        );
      }
    },
  });

  return {
    requireAuth: wrap("requireAuth"),
    enforceCsrfForStateChange: wrap("enforceCsrfForStateChange"),
    attachAuditActor: wrap("attachAuditActor"),
    requireWorkerIssueToken: wrap("requireWorkerIssueToken"),
  };
}

function buildApp(
  routeOpts: Omit<WorkerTokenRouteOptions, "mw"> & {
    mw: WorkerTokenRouteMiddleware;
  },
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
  app.register(workerTokenRoute, routeOpts);
  return app;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("L4.11 — worker token issuance route", () => {
  let audit: ReturnType<typeof makeStubAuditLogger>;

  beforeEach(() => {
    audit = makeStubAuditLogger();
  });

  it("POST happy path → 200 with token + expires_at; token verifies", async () => {
    const app = buildApp({
      workerHmacKey: HMAC_KEY,
      runQueryService: makeStubRunSource({ status: "running" }),
      auditLogger: audit.logger,
      mw: makeMiddlewareBundle({}),
    });
    const r = await app.inject({
      method: "POST",
      url: `/internal/workers/runs/${RUN_ID}/token`,
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { token: string; expires_at: string };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The token verifies against the L3.8 verifier with the run id.
    const v = verifyWorkerToken({
      hmacKey: HMAC_KEY,
      raw: body.token,
      expectedRunId: RUN_ID,
      requiredCapability: "run.write_artifact",
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.claims.workspace_id).toBe(WS_ID);
      expect(v.claims.requested_by_user_id).toBe(USER_ID);
    }

    // Audit emitted the issuance with the hash, NOT the raw token.
    const issued = audit.calls.find((c) => c.action === "worker.token_issued");
    expect(issued).toBeDefined();
    expect(issued?.actorType).toBe("operator");
    expect(issued?.workspaceId).toBe(WS_ID);
    expect(typeof issued?.metadata?.token_hash).toBe("string");
    // The raw token MUST NOT appear in any metadata field.
    const metaJson = JSON.stringify(issued?.metadata ?? {});
    expect(metaJson.includes(body.token)).toBe(false);
  });

  it("POST refused without worker:issue_token capability → 403", async () => {
    const app = buildApp({
      workerHmacKey: HMAC_KEY,
      runQueryService: makeStubRunSource({ status: "running" }),
      auditLogger: audit.logger,
      mw: makeMiddlewareBundle({ workerIssueTokenAllowed: false }),
    });
    const r = await app.inject({
      method: "POST",
      url: `/internal/workers/runs/${RUN_ID}/token`,
      payload: {},
    });
    expect(r.statusCode).toBe(403);
    expect(audit.calls.find((c) => c.action === "worker.token_issued")).toBeUndefined();
  });

  it("POST refuses malformed unauthenticated actor context instead of auditing it as operator", async () => {
    const app = buildApp({
      workerHmacKey: HMAC_KEY,
      runQueryService: makeStubRunSource({ status: "running" }),
      auditLogger: audit.logger,
      mw: makeMiddlewareBundle({ actorType: "unauthenticated" }),
    });
    const r = await app.inject({
      method: "POST",
      url: `/internal/workers/runs/${RUN_ID}/token`,
      payload: {},
    });
    expect(r.statusCode).toBe(401);
    expect(audit.calls.find((c) => c.action === "worker.token_issued")).toBeUndefined();
  });

  it("POST refused for non-existent run → 404 NOT_FOUND", async () => {
    const app = buildApp({
      workerHmacKey: HMAC_KEY,
      runQueryService: makeStubRunSource({ found: false }),
      auditLogger: audit.logger,
      mw: makeMiddlewareBundle({}),
    });
    const r = await app.inject({
      method: "POST",
      url: `/internal/workers/runs/${RUN_ID}/token`,
      payload: {},
    });
    expect(r.statusCode).toBe(404);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(audit.calls.find((c) => c.action === "worker.token_issued")).toBeUndefined();
  });

  it("POST refused for terminal run state (completed) → 409 VERSION_CONFLICT", async () => {
    const app = buildApp({
      workerHmacKey: HMAC_KEY,
      runQueryService: makeStubRunSource({ status: "completed" }),
      auditLogger: audit.logger,
      mw: makeMiddlewareBundle({}),
    });
    const r = await app.inject({
      method: "POST",
      url: `/internal/workers/runs/${RUN_ID}/token`,
      payload: {},
    });
    expect(r.statusCode).toBe(409);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(audit.calls.find((c) => c.action === "worker.token_issued")).toBeUndefined();
  });

  it("POST with forbidden body fields (workspace_id / actor / capsule_id) → 400 UNEXPECTED_FIELD", async () => {
    const app = buildApp({
      workerHmacKey: HMAC_KEY,
      runQueryService: makeStubRunSource({ status: "running" }),
      auditLogger: audit.logger,
      mw: makeMiddlewareBundle({}),
    });
    const r = await app.inject({
      method: "POST",
      url: `/internal/workers/runs/${RUN_ID}/token`,
      payload: {
        workspace_id: "evil-ws",
        actor: "evil",
        capsule_id: "evil-cap",
      },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("UNEXPECTED_FIELD");
    expect(audit.calls.find((c) => c.action === "worker.token_issued")).toBeUndefined();
  });

  it("POST with ttl_seconds > 3600 cap → 400 INPUT_INVALID", async () => {
    const app = buildApp({
      workerHmacKey: HMAC_KEY,
      runQueryService: makeStubRunSource({ status: "running" }),
      auditLogger: audit.logger,
      mw: makeMiddlewareBundle({}),
    });
    const r = await app.inject({
      method: "POST",
      url: `/internal/workers/runs/${RUN_ID}/token`,
      payload: { ttl_seconds: 99999 },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("INPUT_INVALID");
    expect(audit.calls.find((c) => c.action === "worker.token_issued")).toBeUndefined();
  });

  it("POST honors a within-cap ttl_seconds override", async () => {
    const app = buildApp({
      workerHmacKey: HMAC_KEY,
      runQueryService: makeStubRunSource({ status: "queued" }),
      auditLogger: audit.logger,
      mw: makeMiddlewareBundle({}),
    });
    const r = await app.inject({
      method: "POST",
      url: `/internal/workers/runs/${RUN_ID}/token`,
      payload: { ttl_seconds: 60 },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { token: string; expires_at: string };
    const v = verifyWorkerToken({
      hmacKey: HMAC_KEY,
      raw: body.token,
      expectedRunId: RUN_ID,
      requiredCapability: "run.write_artifact",
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      const ttl = v.claims.expires_at - v.claims.issued_at;
      expect(ttl).toBe(60);
    }
  });
});

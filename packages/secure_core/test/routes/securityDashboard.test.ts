import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  securityDashboardRoutes,
  type SecurityDashboardRoutesMiddleware,
} from "../../src/routes/securityDashboard.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import type { NamedMiddleware } from "../../src/middleware/compose.js";
import type { SecurityDashboardSnapshot } from "../../src/security/dashboard.js";
import type {
  AuditEventInput,
  AuditLogger,
} from "../../src/audit/logger.js";

const ACTOR = "33333333-3333-4333-8333-333333333333";

function middleware(opts: {
  readonly authed?: boolean;
  readonly auditAllowed?: boolean;
  readonly assuranceLevel?: "aal1" | "aal2" | "aal3";
}): SecurityDashboardRoutesMiddleware {
  const requireAuth: NamedMiddleware = {
    name: "requireAuth",
    handler: async (req: FastifyRequest) => {
      if (opts.authed === false) {
        throw new SecureCoreError("UNAUTHENTICATED", "no auth");
      }
      req.auth = {
        userId: ACTOR,
        sessionId: "sess",
        actorType: "human",
        assuranceLevel: opts.assuranceLevel ?? "aal2",
      };
    },
  };
  const attachAuditActor: NamedMiddleware = {
    name: "attachAuditActor",
    handler: async (req: FastifyRequest) => {
      req.audit = {
        actorUserId: ACTOR,
        actorType: "human",
        requestId: req.requestId,
      };
    },
  };
  const requireOperatorAuditRead: NamedMiddleware = {
    name: "requireCapability",
    handler: async () => {
      if (opts.auditAllowed === false) {
        throw new SecureCoreError("PERMISSION_DENIED", "no platform:audit_read");
      }
    },
  };
  return { requireAuth, attachAuditActor, requireOperatorAuditRead };
}

const snapshot: SecurityDashboardSnapshot = {
  generatedAt: "2026-05-07T00:00:00.000Z",
  status: "healthy",
  chains: [],
  deniedAccess: [],
  sandboxViolations: [],
};

function makeAuditLogger(): {
  readonly auditLogger: AuditLogger;
  readonly writes: AuditEventInput[];
} {
  const writes: AuditEventInput[] = [];
  return {
    writes,
    auditLogger: {
      write: async (event: AuditEventInput) => {
        writes.push(event);
        return { id: "audit-row" };
      },
    } as unknown as AuditLogger,
  };
}

function buildApp(
  mw: SecurityDashboardRoutesMiddleware,
  auditLogger: AuditLogger = makeAuditLogger().auditLogger,
): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requireRequestId);
  app.setErrorHandler((err, req, reply) => {
    const mapped = toHttpResponse(err, req.requestId ?? "unknown");
    reply.code(mapped.status).send(mapped.body);
  });
  void app.register(securityDashboardRoutes, {
    service: { getSecurityDashboard: async () => snapshot },
    auditLogger,
    mw,
  });
  return app;
}

describe("securityDashboardRoutes", () => {
  it("returns the dashboard for step-up operators with platform audit-read", async () => {
    const app = buildApp(middleware({}));
    const res = await app.inject({
      method: "GET",
      url: "/operator/security-dashboard",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(snapshot);
  });

  it("requires step-up auth", async () => {
    const audit = makeAuditLogger();
    const app = buildApp(
      middleware({ assuranceLevel: "aal1" }),
      audit.auditLogger,
    );
    const res = await app.inject({
      method: "GET",
      url: "/operator/security-dashboard",
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "PERMISSION_DENIED",
    );
    expect(audit.writes).toHaveLength(1);
    expect(audit.writes[0]).toMatchObject({
      actorUserId: ACTOR,
      actorType: "human",
      action: "permission.denied",
      result: "denied",
      metadata: {
        denied_reason: "step_up_required",
        capability: "platform:audit_read",
      },
    });
  });

  it("requires platform:audit_read capability", async () => {
    const app = buildApp(middleware({ auditAllowed: false }));
    const res = await app.inject({
      method: "GET",
      url: "/operator/security-dashboard",
    });
    expect(res.statusCode).toBe(403);
  });
});

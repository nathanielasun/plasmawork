/**
 * `requireCapability` middleware — behavior tests.
 *
 * Pins:
 *   1. Capability typo at factory time fails route registration loudly.
 *   2. Caller with the capability passes through to the handler.
 *   3. Caller without the capability gets PERMISSION_DENIED + audit row
 *      (`permission.denied`, denied result, capability + role metadata).
 *   4. Missing `req.membership` is a programmer error — not a 403, but
 *      a non-user-facing 500 (and the audit is NOT emitted because the
 *      misconfiguration is upstream of the deny gate).
 *   5. Audit row's request id matches `requireRequestId`'s output.
 *   6. Audit row carries the workspace id (when set) and the role name.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../../src/server.js";
import { requireCapability } from "../../src/middleware/requireCapability.js";
import {
  type Capability,
  CAPABILITIES,
} from "../../src/config/capabilities.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type {
  MembershipContext,
  AuditContext,
  WorkspaceContext,
  AuthContext,
} from "../../src/middleware/types.js";
import type { Sql } from "postgres";

interface CapturedAudit {
  action: string;
  result: string;
  workspaceId: string | null;
  actorUserId: string | null;
  actorType: string;
  metadata: Record<string, unknown> | undefined;
  requestId: string;
}

function makeAuditStub(): { logger: AuditLogger; rows: CapturedAudit[] } {
  const rows: CapturedAudit[] = [];
  const stub = {
    write: async (event: {
      action: string;
      result: string;
      workspaceId: string | null;
      actorUserId: string | null;
      actorType: string;
      metadata?: Record<string, unknown>;
      requestId: string;
    }): Promise<void> => {
      rows.push({
        action: event.action,
        result: event.result,
        workspaceId: event.workspaceId,
        actorUserId: event.actorUserId,
        actorType: event.actorType,
        metadata: event.metadata,
        requestId: event.requestId,
      });
    },
  };
  return { logger: stub as unknown as AuditLogger, rows };
}

const stubSql = {} as unknown as Sql;

interface TestSetup {
  capability: Capability;
  capabilitiesGranted: ReadonlyArray<Capability>;
  roleName?: string;
  workspaceId?: string | null;
  actorUserId?: string | null;
  attachMembership?: boolean;
}

function buildAppWithCapabilityRoute(
  audit: { logger: AuditLogger },
  setup: TestSetup,
) {
  const app = buildApp({
    appSql: stubSql,
    errorMapping: {},
    cookieSecret: "test_cookie_secret_minimum_32_bytes_for_hmac",
  });

  const middleware = requireCapability({
    capability: setup.capability,
    auditLogger: audit.logger,
  });

  // Pre-attach `req.auth`, `req.audit`, `req.workspace`, `req.membership`
  // via tiny upstream onRequest hooks so the unit under test sees the
  // inputs §6.2 would have set up.
  app.addHook("preHandler", async (req) => {
    const userId = setup.actorUserId ?? "user-test-1";
    const auth: AuthContext = {
      userId,
      sessionId: "session-test-1",
      actorType: "human",
      assuranceLevel: "aal1",
    };
    const audit: AuditContext = {
      actorUserId: userId,
      actorType: "human",
      requestId: req.requestId,
    };
    if (setup.workspaceId !== null) {
      const ws: WorkspaceContext = {
        id: setup.workspaceId ?? "ws-test-1",
        name: "test-ws",
        createdBy: userId,
      };
      req.workspace = ws;
    }
    req.auth = auth;
    req.audit = audit;
    if (setup.attachMembership !== false) {
      const membership: MembershipContext = {
        workspaceId: setup.workspaceId ?? "ws-test-1",
        userId,
        roleId: "role-test-1",
        roleName: setup.roleName ?? "Researcher",
        capabilities: new Set<Capability>(setup.capabilitiesGranted),
      };
      req.membership = membership;
    }
  });

  app.route({
    method: "GET",
    url: "/gated",
    preHandler: [middleware.handler],
    handler: async (_req, reply) => {
      reply.code(200).send({ ok: true });
    },
  });

  return app;
}

describe("requireCapability — factory-time validation", () => {
  it("throws on unknown capability (typo at registration)", () => {
    const audit = makeAuditStub();
    expect(() =>
      requireCapability({
        // Deliberate typo.
        capability: "capsule:reed" as unknown as Capability,
        auditLogger: audit.logger,
      }),
    ).toThrow(/unknown capability/);
  });

  it("accepts every capability declared in CAPABILITIES", () => {
    const audit = makeAuditStub();
    for (const cap of CAPABILITIES) {
      expect(() =>
        requireCapability({ capability: cap, auditLogger: audit.logger }),
      ).not.toThrow();
    }
  });
});

describe("requireCapability — runtime gating", () => {
  let audit: ReturnType<typeof makeAuditStub>;

  beforeEach(() => {
    audit = makeAuditStub();
  });

  it("passes through when the caller has the required capability", async () => {
    const app = buildAppWithCapabilityRoute(audit, {
      capability: "capsule:read",
      capabilitiesGranted: ["capsule:read", "capsule:update"],
    });
    const res = await app.inject({ method: "GET", url: "/gated" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(audit.rows.length).toBe(0);
    await app.close();
  });

  it("denies + audits when the caller lacks the required capability", async () => {
    const app = buildAppWithCapabilityRoute(audit, {
      capability: "capsule:delete",
      capabilitiesGranted: ["capsule:read"],
      roleName: "Reviewer",
      workspaceId: "ws-deny-1",
      actorUserId: "user-deny-1",
    });
    const res = await app.inject({ method: "GET", url: "/gated" });
    expect(res.statusCode).toBe(403);
    const env = res.json() as {
      error: { code: string; details?: { capability?: string }; request_id: string };
    };
    expect(env.error.code).toBe("PERMISSION_DENIED");
    expect(env.error.details?.capability).toBe("capsule:delete");

    expect(audit.rows.length).toBe(1);
    const row = audit.rows[0]!;
    expect(row.action).toBe("permission.denied");
    expect(row.result).toBe("denied");
    expect(row.workspaceId).toBe("ws-deny-1");
    expect(row.actorUserId).toBe("user-deny-1");
    expect(row.actorType).toBe("human");
    expect(row.metadata).toEqual({
      capability: "capsule:delete",
      role_name: "Reviewer",
    });
    // The request id stamped in the audit row matches the response's.
    expect(row.requestId).toBe(env.error.request_id);
    await app.close();
  });

  it("treats missing req.membership as a 500-level programmer error", async () => {
    const app = buildAppWithCapabilityRoute(audit, {
      capability: "capsule:read",
      capabilitiesGranted: [],
      attachMembership: false,
    });
    const res = await app.inject({ method: "GET", url: "/gated" });
    // Generic Error → INTERNAL_ERROR per the mapper's unknown branch.
    expect(res.statusCode).toBe(500);
    const env = res.json() as { error: { code: string } };
    expect(env.error.code).toBe("INTERNAL_ERROR");
    // Programmer error: no `permission.denied` audit row.
    expect(audit.rows.length).toBe(0);
    await app.close();
  });

  it("emits a single audit row per denied request (no double-write)", async () => {
    const app = buildAppWithCapabilityRoute(audit, {
      capability: "tool:approve_promotion",
      capabilitiesGranted: ["tool:read"],
    });
    const res = await app.inject({ method: "GET", url: "/gated" });
    expect(res.statusCode).toBe(403);
    expect(audit.rows.length).toBe(1);
    await app.close();
  });

  it("includes the role name in the denied-event metadata", async () => {
    const app = buildAppWithCapabilityRoute(audit, {
      capability: "workspace:delete",
      capabilitiesGranted: ["workspace:view"],
      roleName: "Researcher",
    });
    const res = await app.inject({ method: "GET", url: "/gated" });
    expect(res.statusCode).toBe(403);
    expect(audit.rows[0]!.metadata).toMatchObject({ role_name: "Researcher" });
    await app.close();
  });
});

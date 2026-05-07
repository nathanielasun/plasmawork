import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/server.js";
import { registerSecurityOperationsRoutes } from "../../src/security/operations.js";
import type { SecureCorePool } from "../../src/db/pool.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { SecurityDashboardSnapshot } from "../../src/security/dashboard.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function appPool(opts: { platformAllowed: boolean }): SecureCorePool {
  const select = (selection: Record<string, unknown>) => {
    const isAuthLookup = "sessionId" in selection;
    return {
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () => {
                if (isAuthLookup) {
                  return Promise.resolve([
                    {
                      sessionId: SESSION_ID,
                      userId: USER_ID,
                      assuranceLevel: "aal2",
                      revokedAt: null,
                      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
                      userDisabledAt: null,
                    },
                  ]);
                }
                return Promise.resolve(
                  opts.platformAllowed
                    ? [{ capability: "platform:audit_read" }]
                    : [],
                );
              },
            }),
          }),
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  sessionId: SESSION_ID,
                  userId: USER_ID,
                  assuranceLevel: "aal2",
                  revokedAt: null,
                  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
                  userDisabledAt: null,
                },
              ]),
          }),
        }),
      }),
    };
  };
  return {
    role: "app",
    sql: undefined as unknown as SecureCorePool["sql"],
    db: {
      select,
      update: () => ({
        set: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown as SecureCorePool["db"],
    close: async () => {
      /* no-op */
    },
  };
}

function auditReadPool(): SecureCorePool {
  return {
    role: "audit_read",
    sql: undefined as unknown as SecureCorePool["sql"],
    db: undefined as unknown as SecureCorePool["db"],
    close: async () => {
      /* no-op */
    },
  };
}

function auditLogger(): AuditLogger {
  return {
    write: async () => ({ id: "audit-row" }),
  } as unknown as AuditLogger;
}

const snapshot: SecurityDashboardSnapshot = {
  generatedAt: "2026-05-07T00:00:00.000Z",
  status: "healthy",
  chains: [],
  deniedAccess: [],
  sandboxViolations: [],
};

describe("security operations route composition", () => {
  it("registers the dashboard route with real auth and platform-capability middleware", async () => {
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
    });
    await registerSecurityOperationsRoutes(app, {
      appPool: appPool({ platformAllowed: true }),
      auditReadPool: auditReadPool(),
      auditLogger: auditLogger(),
      dashboardService: { getSecurityDashboard: async () => snapshot },
    });

    const res = await app.inject({
      method: "GET",
      url: "/operator/security-dashboard",
      cookies: { secure_session: "session-token" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(snapshot);
    await app.close();
  });

  it("denies dashboard access when the authenticated user lacks platform:audit_read", async () => {
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
    });
    await registerSecurityOperationsRoutes(app, {
      appPool: appPool({ platformAllowed: false }),
      auditReadPool: auditReadPool(),
      auditLogger: auditLogger(),
      dashboardService: { getSecurityDashboard: async () => snapshot },
    });

    const res = await app.inject({
      method: "GET",
      url: "/operator/security-dashboard",
      cookies: { secure_session: "session-token" },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

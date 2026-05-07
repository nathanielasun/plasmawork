import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/server.js";
import { composeMiddleware, type NamedMiddleware } from "../../src/middleware/compose.js";
import { requirePlatformCapability } from "../../src/middleware/requirePlatformCapability.js";
import type { SecureCorePool } from "../../src/db/pool.js";
import type { AuditLogger } from "../../src/audit/logger.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface PlatformGrant {
  readonly userId: string;
  readonly capability: string;
  readonly removedAt: Date | null;
  readonly workspaceDeletedAt: Date | null;
}

function makePool(store: readonly PlatformGrant[]): SecureCorePool {
  const select = () => ({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                store
                  .filter(
                    (grant) =>
                      grant.userId === USER_ID &&
                      grant.capability === "platform:audit_read" &&
                      grant.removedAt === null &&
                      grant.workspaceDeletedAt === null,
                  )
                  .map((grant) => ({ capability: grant.capability }))
                  .slice(0, 1),
              ),
          }),
        }),
      }),
    }),
  });
  return {
    role: "app",
    sql: undefined as unknown as SecureCorePool["sql"],
    db: { select } as unknown as SecureCorePool["db"],
    close: async () => {
      /* no-op */
    },
  };
}

function authContext(): NamedMiddleware {
  return {
    name: "requireAuth",
    handler: async (req) => {
      req.auth = {
        userId: USER_ID,
        sessionId: "22222222-2222-4222-8222-222222222222",
        actorType: "human",
        assuranceLevel: "aal2",
      };
      req.audit = {
        actorUserId: USER_ID,
        actorType: "human",
        requestId: req.requestId,
      };
    },
  };
}

function auditLogger(calls: unknown[]): AuditLogger {
  return {
    write: async (input: unknown) => {
      calls.push(input);
      return { id: "audit-row" };
    },
  } as AuditLogger;
}

async function buildHarness(store: readonly PlatformGrant[]) {
  const calls: unknown[] = [];
  const app = buildApp({
    appSql: undefined as unknown as SecureCorePool["sql"],
    cookieSecret: "test",
  });
  app.get(
    "/operator/probe",
    {
      preHandler: composeMiddleware([
        authContext(),
        requirePlatformCapability({
          capability: "platform:audit_read",
          pool: makePool(store),
          auditLogger: auditLogger(calls),
        }),
      ]),
    },
    async () => ({ ok: true }),
  );
  return { app, calls };
}

describe("requirePlatformCapability", () => {
  it("allows an authenticated user with an active platform grant", async () => {
    const { app } = await buildHarness([
      {
        userId: USER_ID,
        capability: "platform:audit_read",
        removedAt: null,
        workspaceDeletedAt: null,
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/operator/probe" });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("denies and audits missing or removed platform grants", async () => {
    const { app, calls } = await buildHarness([
      {
        userId: USER_ID,
        capability: "platform:audit_read",
        removedAt: new Date("2026-05-07T00:00:00.000Z"),
        workspaceDeletedAt: null,
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/operator/probe" });

    expect(res.statusCode).toBe(403);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      actorUserId: USER_ID,
      action: "permission.denied",
      metadata: { capability: "platform:audit_read" },
    });
    await app.close();
  });

  it("denies platform grants attached only to deleted workspaces", async () => {
    const { app } = await buildHarness([
      {
        userId: USER_ID,
        capability: "platform:audit_read",
        removedAt: null,
        workspaceDeletedAt: new Date("2026-05-07T00:00:00.000Z"),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/operator/probe" });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("refuses non-platform capabilities at registration time", () => {
    expect(() =>
      requirePlatformCapability({
        capability: "capsule:read",
        pool: makePool([]),
        auditLogger: auditLogger([]),
      }),
    ).toThrow(/not a platform capability/);
  });
});

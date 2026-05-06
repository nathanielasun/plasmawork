/**
 * L2.5 `requireWorkspaceMembership` — behavior tests.
 *
 * Pins:
 *   1. Active member with capabilities → `req.membership` carries the
 *      role id, role name, and a `ReadonlySet<Capability>`.
 *   2. Member with role rows but zero `role_permissions` rows still
 *      attaches `req.membership` with an empty capability set (the
 *      LEFT JOIN preserves the membership; capability filtering is
 *      `requireCapability`'s job).
 *   3. Non-member returns the uniform 404 (§4.4) — no distinguishing
 *      "you are not a member" message.
 *   4. Removed member (`removed_at IS NOT NULL`) returns the uniform
 *      404; not membership.
 *   5. Capability values that aren't in the `Capability` literal-union
 *      are silently dropped (drift detection happens in audit, not at
 *      request time).
 *   6. Missing `req.auth` is a programmer error → INTERNAL_ERROR (the
 *      composer would normally have wired requireAuth upstream).
 */

import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/server.js";
import { composeMiddleware } from "../../src/middleware/compose.js";
import { requireWorkspaceMembership } from "../../src/middleware/requireWorkspaceMembership.js";
import type { SecureCorePool } from "../../src/db/pool.js";
import type { Capability } from "../../src/config/capabilities.js";

interface MembershipRow {
  workspaceId: string;
  userId: string;
  removedAt: Date | null;
  roleId: string;
  roleName: string;
  /** Capability rows for the role. */
  capabilities: ReadonlyArray<string>;
}

const candidate: { workspaceId: string; userId: string } = {
  workspaceId: "",
  userId: "",
};

/**
 * Fake `SecureCorePool` that simulates the join the middleware issues.
 * Filters in-memory by `(workspaceId, userId, removedAt IS NULL)` and
 * returns one row per capability — empty capabilities still yields one
 * "row" with `capability: null` to simulate the LEFT JOIN's behavior
 * for a role that has no role_permissions entries.
 */
function makePool(store: ReadonlyArray<MembershipRow>): SecureCorePool {
  const select = () => ({
    from: () => ({
      innerJoin: () => ({
        leftJoin: () => ({
          where: () =>
            Promise.resolve(
              store
                .filter(
                  (m) =>
                    m.workspaceId === candidate.workspaceId &&
                    m.userId === candidate.userId &&
                    m.removedAt === null,
                )
                .flatMap(
                  (
                    m,
                  ): Array<{
                    roleId: string;
                    roleName: string;
                    capability: string | null;
                  }> =>
                    m.capabilities.length === 0
                      ? [
                          {
                            roleId: m.roleId,
                            roleName: m.roleName,
                            capability: null,
                          },
                        ]
                      : m.capabilities.map((capability) => ({
                          roleId: m.roleId,
                          roleName: m.roleName,
                          capability,
                        })),
                ),
            ),
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

const WS_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ROLE_ID = "33333333-3333-4333-8333-333333333333";

/** Pre-attach req.auth + req.workspace as a tiny upstream test handler. */
function preAttachContext(): { name: "loadWorkspace"; handler: (req: import("fastify").FastifyRequest) => Promise<void> } {
  return {
    name: "loadWorkspace",
    handler: async (req) => {
      candidate.workspaceId = WS_ID;
      candidate.userId = USER_ID;
      req.auth = {
        userId: USER_ID,
        sessionId: "session-id",
        actorType: "human",
        assuranceLevel: "aal2",
      };
      req.workspace = {
        id: WS_ID,
        name: "alpha",
        createdBy: USER_ID,
      };
    },
  };
}

describe("requireWorkspaceMembership", () => {
  it("attaches req.membership with role + capabilities for an active member", async () => {
    const pool = makePool([
      {
        workspaceId: WS_ID,
        userId: USER_ID,
        removedAt: null,
        roleId: ROLE_ID,
        roleName: "Researcher",
        capabilities: ["capsule:read", "capsule:create"] satisfies Capability[],
      },
    ]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/probe",
      {
        preHandler: composeMiddleware([
          preAttachContext(),
          requireWorkspaceMembership({ pool }),
        ]),
      },
      async (req) => ({
        roleId: req.membership?.roleId ?? null,
        roleName: req.membership?.roleName ?? null,
        capabilities: req.membership
          ? Array.from(req.membership.capabilities).sort()
          : [],
      }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/probe`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      roleId: ROLE_ID,
      roleName: "Researcher",
      capabilities: ["capsule:create", "capsule:read"],
    });
    await app.close();
  });

  it("attaches an empty capability set when the role has no role_permissions", async () => {
    const pool = makePool([
      {
        workspaceId: WS_ID,
        userId: USER_ID,
        removedAt: null,
        roleId: ROLE_ID,
        roleName: "EmptyRole",
        capabilities: [],
      },
    ]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/probe",
      {
        preHandler: composeMiddleware([
          preAttachContext(),
          requireWorkspaceMembership({ pool }),
        ]),
      },
      async (req) => ({
        roleName: req.membership?.roleName ?? null,
        capabilities: req.membership
          ? Array.from(req.membership.capabilities)
          : null,
      }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/probe`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      roleName: "EmptyRole",
      capabilities: [],
    });
    await app.close();
  });

  it("returns uniform 404 for a non-member", async () => {
    const pool = makePool([]); // no membership rows
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/probe",
      {
        preHandler: composeMiddleware([
          preAttachContext(),
          requireWorkspaceMembership({ pool }),
        ]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/probe`,
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Not found.");
    await app.close();
  });

  it("returns uniform 404 when the membership is soft-removed", async () => {
    const pool = makePool([
      {
        workspaceId: WS_ID,
        userId: USER_ID,
        removedAt: new Date("2026-04-01T00:00:00Z"),
        roleId: ROLE_ID,
        roleName: "Researcher",
        capabilities: ["capsule:read"] satisfies Capability[],
      },
    ]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/probe",
      {
        preHandler: composeMiddleware([
          preAttachContext(),
          requireWorkspaceMembership({ pool }),
        ]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/probe`,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
    await app.close();
  });

  it("silently drops capability strings that aren't in the literal-union", async () => {
    const pool = makePool([
      {
        workspaceId: WS_ID,
        userId: USER_ID,
        removedAt: null,
        roleId: ROLE_ID,
        roleName: "Researcher",
        capabilities: ["capsule:read", "not_a_capability:bogus"],
      },
    ]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/probe",
      {
        preHandler: composeMiddleware([
          preAttachContext(),
          requireWorkspaceMembership({ pool }),
        ]),
      },
      async (req) => ({
        capabilities: req.membership
          ? Array.from(req.membership.capabilities)
          : [],
      }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/probe`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ capabilities: ["capsule:read"] });
    await app.close();
  });

  it("surfaces INTERNAL_ERROR if req.auth is missing (composer misconfiguration)", async () => {
    const pool = makePool([]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/probe",
      {
        // Deliberately skip preAttachContext: req.auth + req.workspace
        // are both missing. The middleware refuses with a plain Error
        // that the §3 mapper turns into INTERNAL_ERROR / 500.
        preHandler: composeMiddleware([requireWorkspaceMembership({ pool })]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/probe`,
    });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "INTERNAL_ERROR",
    );
    await app.close();
  });
});

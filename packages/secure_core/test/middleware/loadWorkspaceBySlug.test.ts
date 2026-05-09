/**
 * `loadWorkspaceBySlug` — behavior tests.
 *
 * Mirrors the `loadWorkspace.test.ts` shape but for the slug-keyed
 * variant introduced in Phase E2-rest. Pins:
 *
 *   1. Slug alphabet enforcement: ``[A-Za-z0-9_-]{3,64}``. Inputs
 *      outside the alphabet collapse into the same uniform 404 as
 *      a missing workspace.
 *   2. Existing, non-deleted workspace attaches `req.workspace`.
 *   3. Soft-deleted workspace returns the same uniform 404.
 *   4. The handler reads only `req.params[slugParam]` — no body,
 *      header, or query field influences the lookup.
 */

import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/server.js";
import { composeMiddleware } from "../../src/middleware/compose.js";
import { loadWorkspaceBySlug } from "../../src/middleware/loadWorkspaceBySlug.js";
import type { SecureCorePool } from "../../src/db/pool.js";

interface WorkspaceRow {
  id: string;
  name: string;
  createdBy: string;
  deletedAt: Date | null;
}

const candidateSlug = { value: "" };

function makePoolWithWorkspaces(
  store: ReadonlyArray<WorkspaceRow>,
): SecureCorePool {
  const select = () => ({
    from: () => ({
      where: (predicate: unknown) =>
        ({
          limit: () => {
            void predicate;
            return Promise.resolve(
              store
                .filter(
                  (r) => r.name === candidateSlug.value && r.deletedAt === null,
                )
                .map((r) => ({
                  id: r.id,
                  name: r.name,
                  createdBy: r.createdBy,
                })),
            );
          },
        }) as unknown,
    }),
  });
  return {
    role: "app",
    sql: undefined as unknown as SecureCorePool["sql"],
    db: { select } as unknown as SecureCorePool["db"],
    close: async () => {},
  };
}

const VALID_UUID_V4 = "11111111-1111-4111-8111-111111111111";
const COOKIE_SECRET = "test_cookie_secret_minimum_32_bytes_for_hmac";

describe("loadWorkspaceBySlug", () => {
  it("attaches req.workspace when the workspace exists and is not deleted", async () => {
    const pool = makePoolWithWorkspaces([
      {
        id: VALID_UUID_V4,
        name: "shared-public-experiments",
        createdBy: VALID_UUID_V4,
        deletedAt: null,
      },
    ]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: COOKIE_SECRET,
      errorMapping: { dev: false },
    });
    app.get(
      "/api/:slug/probe",
      {
        preHandler: composeMiddleware([
          {
            name: "loadWorkspace",
            handler: async (req) => {
              const params = req.params as Record<string, string>;
              candidateSlug.value = params.slug ?? "";
              await loadWorkspaceBySlug({ pool }).handler(req, {} as never);
            },
          },
        ]),
      },
      async (req) => ({
        ok: true,
        workspaceId: req.workspace?.id ?? null,
        workspaceName: req.workspace?.name ?? null,
      }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/shared-public-experiments/probe`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      workspaceId: VALID_UUID_V4,
      workspaceName: "shared-public-experiments",
    });
    await app.close();
  });

  it("returns uniform 404 for an unsafe slug", async () => {
    const pool = makePoolWithWorkspaces([]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: COOKIE_SECRET,
      errorMapping: { dev: false },
    });
    // Routes match by Fastify's URL parser; a slug containing "/" or
    // ".." would never reach the middleware (the URL split splits
    // the path). The closest reachable malformed slug is one with a
    // disallowed character that still matches Fastify's segment.
    app.get(
      "/api/:slug/probe",
      {
        preHandler: composeMiddleware([loadWorkspaceBySlug({ pool })]),
      },
      async () => ({ ok: true }),
    );
    // Underscore + space as a segment is one URL away — but space
    // gets URL-encoded; an exclamation mark is the simplest disallowed
    // char.
    const res = await app.inject({
      method: "GET",
      url: `/api/has%21bang/probe`,
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Not found.");
    await app.close();
  });

  it("returns uniform 404 when the workspace doesn't exist", async () => {
    const pool = makePoolWithWorkspaces([]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: COOKIE_SECRET,
      errorMapping: { dev: false },
    });
    app.get(
      "/api/:slug/probe",
      {
        preHandler: composeMiddleware([
          {
            name: "loadWorkspace",
            handler: async (req) => {
              const params = req.params as Record<string, string>;
              candidateSlug.value = params.slug ?? "";
              await loadWorkspaceBySlug({ pool }).handler(req, {} as never);
            },
          },
        ]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/nonexistent/probe`,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
    await app.close();
  });

  it("returns uniform 404 when the workspace is soft-deleted", async () => {
    const pool = makePoolWithWorkspaces([
      {
        id: VALID_UUID_V4,
        name: "deleted-workspace",
        createdBy: VALID_UUID_V4,
        deletedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: COOKIE_SECRET,
      errorMapping: { dev: false },
    });
    app.get(
      "/api/:slug/probe",
      {
        preHandler: composeMiddleware([
          {
            name: "loadWorkspace",
            handler: async (req) => {
              const params = req.params as Record<string, string>;
              candidateSlug.value = params.slug ?? "";
              await loadWorkspaceBySlug({ pool }).handler(req, {} as never);
            },
          },
        ]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/deleted-workspace/probe`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("alternate slug param key works", async () => {
    const pool = makePoolWithWorkspaces([
      {
        id: VALID_UUID_V4,
        name: "alt-key-ws",
        createdBy: VALID_UUID_V4,
        deletedAt: null,
      },
    ]);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: COOKIE_SECRET,
      errorMapping: { dev: false },
    });
    app.get(
      "/ws/:workspaceSlug/probe",
      {
        preHandler: composeMiddleware([
          {
            name: "loadWorkspace",
            handler: async (req) => {
              const params = req.params as Record<string, string>;
              candidateSlug.value = params.workspaceSlug ?? "";
              await loadWorkspaceBySlug({
                pool,
                slugParam: "workspaceSlug",
              }).handler(req, {} as never);
            },
          },
        ]),
      },
      async (req) => ({ id: req.workspace?.id ?? null }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/ws/alt-key-ws/probe`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: VALID_UUID_V4 });
    await app.close();
  });
});

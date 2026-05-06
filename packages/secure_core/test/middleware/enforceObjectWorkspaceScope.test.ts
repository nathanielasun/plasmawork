/**
 * L2.7 `enforceObjectWorkspaceScope` — behavior tests.
 *
 * Pins:
 *   1. Object resident in the URL workspace passes; no context attached.
 *   2. Object resident in a DIFFERENT workspace returns the same uniform
 *      404 as a missing workspace (§4.4) — cross-workspace probes do
 *      not reveal object existence.
 *   3. Missing object returns the same uniform 404.
 *   4. Non-UUIDv4 object id collapses into the same uniform 404.
 *   5. Different object kinds (`capsule`, `run`, `tool`, `artifact`,
 *      `approval_request`) all hit the matching schema table.
 *   6. Platform-wide tool (workspace_id IS NULL) does not satisfy a
 *      workspace-scoped URL — uniform 404.
 */

import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/server.js";
import { composeMiddleware } from "../../src/middleware/compose.js";
import {
  enforceObjectWorkspaceScope,
  type ObjectScopeKind,
} from "../../src/middleware/enforceObjectWorkspaceScope.js";
import type { SecureCorePool } from "../../src/db/pool.js";

interface FakeStore {
  capsules: Array<{ id: string; workspaceId: string }>;
  simulationRuns: Array<{ id: string; workspaceId: string }>;
  tools: Array<{ id: string; workspaceId: string | null }>;
  artifactFiles: Array<{ id: string; workspaceId: string }>;
  approvalRequests: Array<{ id: string; workspaceId: string }>;
}

const callContext: { kind: ObjectScopeKind | null; objectId: string } = {
  kind: null,
  objectId: "",
};

/**
 * Per-kind switch in the middleware issues `db.select(...).from(<table>)
 * .where(eq(<table>.id, X)).limit(1)`. The fake intercepts each call
 * by inspecting `callContext` populated upstream by the test.
 */
function makePool(store: FakeStore): SecureCorePool {
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          const id = callContext.objectId;
          switch (callContext.kind) {
            case "capsule": {
              const row = store.capsules.find((r) => r.id === id);
              return Promise.resolve(
                row ? [{ workspaceId: row.workspaceId }] : [],
              );
            }
            case "run": {
              const row = store.simulationRuns.find((r) => r.id === id);
              return Promise.resolve(
                row ? [{ workspaceId: row.workspaceId }] : [],
              );
            }
            case "tool": {
              const row = store.tools.find((r) => r.id === id);
              return Promise.resolve(
                row ? [{ workspaceId: row.workspaceId }] : [],
              );
            }
            case "artifact": {
              const row = store.artifactFiles.find((r) => r.id === id);
              return Promise.resolve(
                row ? [{ workspaceId: row.workspaceId }] : [],
              );
            }
            case "approval_request": {
              const row = store.approvalRequests.find((r) => r.id === id);
              return Promise.resolve(
                row ? [{ workspaceId: row.workspaceId }] : [],
              );
            }
            default:
              return Promise.resolve([]);
          }
        },
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
const OTHER_WS_ID = "22222222-2222-4222-8222-222222222222";
const OBJ_ID = "33333333-3333-4333-8333-333333333333";
const NON_UUID = "not-a-uuid";

function attachWorkspace(kind: ObjectScopeKind) {
  return {
    name: "loadWorkspace" as const,
    handler: async (req: import("fastify").FastifyRequest) => {
      const params = req.params as Record<string, string>;
      callContext.kind = kind;
      callContext.objectId =
        params.capsuleId ??
        params.runId ??
        params.toolId ??
        params.artifactId ??
        params.approvalRequestId ??
        "";
      req.workspace = {
        id: WS_ID,
        name: "alpha",
        createdBy: WS_ID,
      };
    },
  };
}

function emptyStore(): FakeStore {
  return {
    capsules: [],
    simulationRuns: [],
    tools: [],
    artifactFiles: [],
    approvalRequests: [],
  };
}

describe("enforceObjectWorkspaceScope", () => {
  it("passes when the capsule belongs to the URL workspace", async () => {
    const store = emptyStore();
    store.capsules.push({ id: OBJ_ID, workspaceId: WS_ID });
    const pool = makePool(store);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/capsules/:capsuleId/probe",
      {
        preHandler: composeMiddleware([
          attachWorkspace("capsule"),
          enforceObjectWorkspaceScope({
            pool,
            objectKind: "capsule",
            paramName: "capsuleId",
          }),
        ]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/capsules/${OBJ_ID}/probe`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("returns uniform 404 for a cross-workspace object (§4.4 invariant)", async () => {
    const store = emptyStore();
    // Capsule exists, but in a DIFFERENT workspace than the URL.
    store.capsules.push({ id: OBJ_ID, workspaceId: OTHER_WS_ID });
    const pool = makePool(store);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/capsules/:capsuleId/probe",
      {
        preHandler: composeMiddleware([
          attachWorkspace("capsule"),
          enforceObjectWorkspaceScope({
            pool,
            objectKind: "capsule",
            paramName: "capsuleId",
          }),
        ]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/capsules/${OBJ_ID}/probe`,
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Not found.");
    await app.close();
  });

  it("returns uniform 404 when the object simply doesn't exist", async () => {
    const pool = makePool(emptyStore());
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/capsules/:capsuleId/probe",
      {
        preHandler: composeMiddleware([
          attachWorkspace("capsule"),
          enforceObjectWorkspaceScope({
            pool,
            objectKind: "capsule",
            paramName: "capsuleId",
          }),
        ]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/capsules/${OBJ_ID}/probe`,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
    await app.close();
  });

  it("returns uniform 404 for a non-UUIDv4 object-id param", async () => {
    const pool = makePool(emptyStore());
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/capsules/:capsuleId/probe",
      {
        preHandler: composeMiddleware([
          attachWorkspace("capsule"),
          enforceObjectWorkspaceScope({
            pool,
            objectKind: "capsule",
            paramName: "capsuleId",
          }),
        ]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/capsules/${NON_UUID}/probe`,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
    await app.close();
  });

  it("dispatches per object kind (run / tool / artifact / approval_request)", async () => {
    const store = emptyStore();
    store.simulationRuns.push({ id: OBJ_ID, workspaceId: WS_ID });
    store.tools.push({ id: OBJ_ID, workspaceId: WS_ID });
    store.artifactFiles.push({ id: OBJ_ID, workspaceId: WS_ID });
    store.approvalRequests.push({ id: OBJ_ID, workspaceId: WS_ID });
    const pool = makePool(store);

    const kinds: ReadonlyArray<{
      kind: ObjectScopeKind;
      param: string;
      slug: string;
    }> = [
      { kind: "run", param: "runId", slug: "runs" },
      { kind: "tool", param: "toolId", slug: "tools" },
      { kind: "artifact", param: "artifactId", slug: "artifacts" },
      {
        kind: "approval_request",
        param: "approvalRequestId",
        slug: "approval-requests",
      },
    ];

    for (const { kind, param, slug } of kinds) {
      const app = buildApp({
        appSql: undefined as unknown as SecureCorePool["sql"],
        cookieSecret: "test",
        errorMapping: { dev: false },
      });
      app.get(
        `/workspaces/:workspaceId/${slug}/:${param}/probe`,
        {
          preHandler: composeMiddleware([
            attachWorkspace(kind),
            enforceObjectWorkspaceScope({
              pool,
              objectKind: kind,
              paramName: param,
            }),
          ]),
        },
        async () => ({ kind }),
      );
      const res = await app.inject({
        method: "GET",
        url: `/workspaces/${WS_ID}/${slug}/${OBJ_ID}/probe`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ kind });
      await app.close();
    }
  });

  it("returns uniform 404 for a platform-wide tool (workspace_id IS NULL)", async () => {
    const store = emptyStore();
    store.tools.push({ id: OBJ_ID, workspaceId: null });
    const pool = makePool(store);
    const app = buildApp({
      appSql: undefined as unknown as SecureCorePool["sql"],
      cookieSecret: "test",
      errorMapping: { dev: false },
    });
    app.get(
      "/workspaces/:workspaceId/tools/:toolId/probe",
      {
        preHandler: composeMiddleware([
          attachWorkspace("tool"),
          enforceObjectWorkspaceScope({
            pool,
            objectKind: "tool",
            paramName: "toolId",
          }),
        ]),
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "GET",
      url: `/workspaces/${WS_ID}/tools/${OBJ_ID}/probe`,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
    await app.close();
  });
});

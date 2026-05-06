/**
 * L2.1 `requireAuth` — behavior tests.
 *
 * Pins each rejection in the v4 §5 ladder plus the happy-path attach.
 * The Drizzle `db` is mocked via a fluent stub; no real Postgres is
 * required, so these tests run regardless of `PLASMAWORK_TEST_DB_URL`.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

import { requireAuth } from "../../src/middleware/requireAuth.js";
import { composeMiddleware } from "../../src/middleware/compose.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import "../../src/middleware/fastify_augment.js";
import { hashToken } from "../../src/crypto/tokens.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { SecureCorePool } from "../../src/db/pool.js";

interface SessionRow {
  sessionId: string;
  userId: string;
  assuranceLevel: string;
  revokedAt: Date | null;
  expiresAt: Date;
  userDisabledAt: Date | null;
}

interface Mocks {
  pool: SecureCorePool;
  auditLogger: AuditLogger;
  writes: Array<{ action: string; result: string; actorUserId: string | null }>;
  selectCalls: { lastWhereHash?: string };
  updateCalls: { count: number };
}

function makeMocks(opts: {
  rows: SessionRow[];
  failUpdate?: boolean;
}): Mocks {
  const writes: Mocks["writes"] = [];
  const selectCalls: Mocks["selectCalls"] = {};
  const updateCalls: Mocks["updateCalls"] = { count: 0 };

  // Capture the where-arg via Drizzle's eq value. We can't easily
  // introspect it, so we just return all rows and let the limit(1) take
  // the first; tests register one row at a time.
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => selectChain,
    limit: async (_n: number): Promise<SessionRow[]> => opts.rows,
  };

  const updateChain = {
    set: () => updateChain,
    where: (): Promise<void> => {
      updateCalls.count += 1;
      return opts.failUpdate
        ? Promise.reject(new Error("update boom"))
        : Promise.resolve();
    },
  };

  const db = {
    select: () => selectChain,
    update: () => updateChain,
  };

  const pool = { db } as unknown as SecureCorePool;

  const auditLogger = {
    write: vi.fn(async (input: {
      action: string;
      result: string;
      actorUserId: string | null;
    }) => {
      writes.push({
        action: input.action,
        result: input.result,
        actorUserId: input.actorUserId,
      });
      return undefined as unknown as never;
    }),
  } as unknown as AuditLogger;

  return { pool, auditLogger, writes, selectCalls, updateCalls };
}

async function buildTestApp(
  rows: SessionRow[],
  opts?: { failUpdate?: boolean },
): Promise<{ app: FastifyInstance; mocks: Mocks }> {
  const mocks = makeMocks({ rows, failUpdate: opts?.failUpdate });
  const app = Fastify();
  await app.register(cookie);
  app.addHook("onRequest", requireRequestId);
  app.setErrorHandler((err, req, reply) => {
    const mapped = toHttpResponse(err, req.requestId ?? "test");
    reply.code(mapped.status).send(mapped.body);
  });

  const mw = requireAuth({
    pool: mocks.pool,
    auditLogger: mocks.auditLogger,
  });
  const handlers = composeMiddleware([mw]);

  app.get(
    "/whoami",
    { preHandler: handlers },
    async (req) => ({
      ok: true,
      auth: req.auth ?? null,
    }),
  );

  return { app, mocks };
}

const VALID_TOKEN = "test-token-abcdef123456";
const VALID_HASH = hashToken(VALID_TOKEN);

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    assuranceLevel: "aal1",
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    userDisabledAt: null,
    ...overrides,
  };
}

describe("requireAuth", () => {
  it("rejects with 401 and emits no audit when cookie is missing", async () => {
    const { app, mocks } = await buildTestApp([]);
    const res = await app.inject({ method: "GET", url: "/whoami" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
    expect(mocks.writes).toHaveLength(0);
    await app.close();
  });

  it("rejects unknown session hash with login.failed audit (unauthenticated actor)", async () => {
    const { app, mocks } = await buildTestApp([]);
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      cookies: { secure_session: "no-such-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
    expect(mocks.writes).toEqual([
      { action: "login.failed", result: "denied", actorUserId: null },
    ]);
    await app.close();
  });

  it("rejects revoked session with session.revoked audit", async () => {
    const r = row({ revokedAt: new Date(Date.now() - 60_000) });
    const { app, mocks } = await buildTestApp([r]);
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      cookies: { secure_session: VALID_TOKEN },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("SESSION_REVOKED");
    expect(mocks.writes).toEqual([
      {
        action: "session.revoked",
        result: "denied",
        actorUserId: r.userId,
      },
    ]);
    expect(VALID_HASH.length).toBe(64);
    await app.close();
  });

  it("rejects expired session with session.idle_timeout audit", async () => {
    const r = row({ expiresAt: new Date(Date.now() - 1) });
    const { app, mocks } = await buildTestApp([r]);
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      cookies: { secure_session: VALID_TOKEN },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("SESSION_EXPIRED");
    expect(mocks.writes).toEqual([
      {
        action: "session.idle_timeout",
        result: "denied",
        actorUserId: r.userId,
      },
    ]);
    await app.close();
  });

  it("rejects disabled user with login.failed + DISABLED_USER", async () => {
    const r = row({ userDisabledAt: new Date(Date.now() - 60_000) });
    const { app, mocks } = await buildTestApp([r]);
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      cookies: { secure_session: VALID_TOKEN },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("DISABLED_USER");
    expect(mocks.writes).toEqual([
      {
        action: "login.failed",
        result: "denied",
        actorUserId: r.userId,
      },
    ]);
    await app.close();
  });

  it("happy path attaches AuthContext and bumps last_seen_at", async () => {
    const r = row();
    const { app, mocks } = await buildTestApp([r]);
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      cookies: { secure_session: VALID_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; auth: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.auth).toEqual({
      userId: r.userId,
      sessionId: r.sessionId,
      actorType: "human",
      assuranceLevel: "aal1",
    });
    expect(mocks.writes).toHaveLength(0);
    // last_seen_at update fires; we don't await it but it must have
    // been initiated synchronously.
    expect(mocks.updateCalls.count).toBe(1);
    await app.close();
  });

  it("happy path tolerates a failing last_seen_at update", async () => {
    const r = row();
    const { app, mocks } = await buildTestApp([r], { failUpdate: true });
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      cookies: { secure_session: VALID_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.writes).toHaveLength(0);
    expect(SecureCoreError).toBeDefined();
    await app.close();
  });
});

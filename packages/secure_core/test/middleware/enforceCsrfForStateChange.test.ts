/**
 * L2.2 `enforceCsrfForStateChange` — behavior tests.
 *
 * Pins:
 *  - Idempotent methods bypass entirely.
 *  - State-changing methods enforce Origin/Referer first.
 *  - Authenticated state-change requires the synchronizer-token pair.
 *  - Unauthenticated state-change requires only Origin.
 *  - Each rejection emits the v4 §7.2 audit event with `result=denied`.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

import {
  enforceCsrfForStateChange,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../../src/middleware/enforceCsrfForStateChange.js";
import { composeMiddleware } from "../../src/middleware/compose.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { hashToken } from "../../src/crypto/tokens.js";
import "../../src/middleware/fastify_augment.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { AuthContext } from "../../src/middleware/types.js";

interface Mocks {
  auditLogger: AuditLogger;
  writes: Array<{ action: string; result: string }>;
}

const ALLOWED = ["https://app.plasmawork.test"] as const;

function makeMocks(): Mocks {
  const writes: Mocks["writes"] = [];
  const auditLogger = {
    write: vi.fn(async (input: { action: string; result: string }) => {
      writes.push({ action: input.action, result: input.result });
      return undefined as unknown as never;
    }),
  } as unknown as AuditLogger;
  return { auditLogger, writes };
}

async function buildTestApp(opts: {
  authed: boolean;
}): Promise<{ app: FastifyInstance; mocks: Mocks }> {
  const mocks = makeMocks();
  const app = Fastify();
  await app.register(cookie);
  app.addHook("onRequest", requireRequestId);

  // For "authenticated" tests, stub `req.auth` before CSRF runs.
  if (opts.authed) {
    app.addHook("preHandler", async (req) => {
      const auth: AuthContext = {
        userId: "00000000-0000-0000-0000-000000000001",
        sessionId: "00000000-0000-0000-0000-000000000002",
        actorType: "human",
        assuranceLevel: "aal1",
      };
      req.auth = auth;
    });
  }

  app.setErrorHandler((err, req, reply) => {
    const mapped = toHttpResponse(err, req.requestId ?? "test");
    reply.code(mapped.status).send(mapped.body);
  });

  const mw = enforceCsrfForStateChange({
    auditLogger: mocks.auditLogger,
    allowedOrigins: ALLOWED,
  });
  const handlers = composeMiddleware([mw]);

  app.route({
    method: ["GET", "POST", "PUT", "DELETE"],
    url: "/state",
    preHandler: handlers,
    handler: async () => ({ ok: true }),
  });

  return { app, mocks };
}

describe("enforceCsrfForStateChange", () => {
  it("GET passes without any header", async () => {
    const { app, mocks } = await buildTestApp({ authed: false });
    const res = await app.inject({ method: "GET", url: "/state" });
    expect(res.statusCode).toBe(200);
    expect(mocks.writes).toHaveLength(0);
    await app.close();
  });

  it("POST without Origin or Referer fails ORIGIN_MISMATCH", async () => {
    const { app, mocks } = await buildTestApp({ authed: false });
    const res = await app.inject({ method: "POST", url: "/state" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("ORIGIN_MISMATCH");
    expect(mocks.writes).toEqual([
      { action: "origin.mismatch", result: "denied" },
    ]);
    await app.close();
  });

  it("POST with disallowed Origin fails ORIGIN_MISMATCH", async () => {
    const { app, mocks } = await buildTestApp({ authed: false });
    const res = await app.inject({
      method: "POST",
      url: "/state",
      headers: { origin: "https://attacker.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("ORIGIN_MISMATCH");
    expect(mocks.writes).toEqual([
      { action: "origin.mismatch", result: "denied" },
    ]);
    await app.close();
  });

  it("POST authed without X-CSRF-Token fails CSRF_FAILED", async () => {
    const { app, mocks } = await buildTestApp({ authed: true });
    const csrfRaw = "a-csrf-token";
    const res = await app.inject({
      method: "POST",
      url: "/state",
      headers: { origin: ALLOWED[0] },
      cookies: { [CSRF_COOKIE_NAME]: csrfRaw },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("CSRF_FAILED");
    expect(mocks.writes).toEqual([
      { action: "csrf.failed", result: "denied" },
    ]);
    await app.close();
  });

  it("POST authed with mismatched header fails CSRF_FAILED", async () => {
    const { app, mocks } = await buildTestApp({ authed: true });
    const res = await app.inject({
      method: "POST",
      url: "/state",
      headers: {
        origin: ALLOWED[0],
        [CSRF_HEADER_NAME]: "different-value",
      },
      cookies: { [CSRF_COOKIE_NAME]: "a-csrf-token" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("CSRF_FAILED");
    expect(mocks.writes).toEqual([
      { action: "csrf.failed", result: "denied" },
    ]);
    await app.close();
  });

  it("POST unauthed with valid Origin passes (no synchronizer required)", async () => {
    const { app, mocks } = await buildTestApp({ authed: false });
    const res = await app.inject({
      method: "POST",
      url: "/state",
      headers: { origin: ALLOWED[0] },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.writes).toHaveLength(0);
    await app.close();
  });

  it("POST authed with matching Origin/cookie/header passes", async () => {
    const { app, mocks } = await buildTestApp({ authed: true });
    const csrfRaw = "shared-csrf-secret";
    const csrfHash = hashToken(csrfRaw);
    // The middleware compares header → hashToken(headerValue) against
    // hashToken(cookieValue) — when both inputs are equal raw strings,
    // the hashes match.
    expect(hashToken(csrfRaw)).toBe(csrfHash);
    const res = await app.inject({
      method: "POST",
      url: "/state",
      headers: {
        origin: ALLOWED[0],
        [CSRF_HEADER_NAME]: csrfRaw,
      },
      cookies: { [CSRF_COOKIE_NAME]: csrfRaw },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.writes).toHaveLength(0);
    await app.close();
  });

  it("Referer is accepted when Origin is missing", async () => {
    const { app, mocks } = await buildTestApp({ authed: false });
    const res = await app.inject({
      method: "POST",
      url: "/state",
      headers: { referer: `${ALLOWED[0]}/login` },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.writes).toHaveLength(0);
    await app.close();
  });
});

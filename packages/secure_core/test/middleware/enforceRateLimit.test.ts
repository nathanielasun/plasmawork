/**
 * L2.12 — enforceRateLimit middleware tests.
 *
 * Covers: window enforcement, lockout precedence over window quota,
 * audit emission with structured `denied_reason`, post-auth keying
 * via custom extractor, factory-time refusal of bad config, and the
 * generic "Too many requests." message (v4 §8 anti-enumeration).
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";

import {
  enforceRateLimit,
  InMemoryRateLimitStore,
  type RateLimitKeyExtractor,
} from "../../src/middleware/enforceRateLimit.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";

interface AuditCall {
  action: string;
  result: string;
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
      metadata?: Record<string, unknown>;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        metadata: input.metadata,
      });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

function makeApp(
  limit: number,
  windowMs: number,
  store: InMemoryRateLimitStore,
  logger: AuditLogger,
  endpoint: string,
  keyExtractor?: RateLimitKeyExtractor,
  now?: () => number,
): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requireRequestId);
  app.setErrorHandler((err, req, reply) => {
    const mapped = toHttpResponse(
      err instanceof SecureCoreError ? err : err,
      req.requestId ?? "unknown",
    );
    reply.code(mapped.status).send(mapped.body);
  });
  const mw = enforceRateLimit({
    limit,
    windowMs,
    store,
    auditLogger: logger,
    endpoint,
    keyExtractor,
    now,
  });
  app.get("/probe", { preHandler: mw.handler }, async () => ({ ok: true }));
  return app;
}

describe("enforceRateLimit — L2.12", () => {
  let store: InMemoryRateLimitStore;
  let stub: ReturnType<typeof makeStubAuditLogger>;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
    stub = makeStubAuditLogger();
  });

  it("factory rejects non-positive integer limit", () => {
    expect(() =>
      enforceRateLimit({
        limit: 0,
        windowMs: 1000,
        store,
        auditLogger: stub.logger,
        endpoint: "test",
      }),
    ).toThrow(/positive integer/);
    expect(() =>
      enforceRateLimit({
        limit: -1,
        windowMs: 1000,
        store,
        auditLogger: stub.logger,
        endpoint: "test",
      }),
    ).toThrow(/positive integer/);
    expect(() =>
      enforceRateLimit({
        limit: 1.5,
        windowMs: 1000,
        store,
        auditLogger: stub.logger,
        endpoint: "test",
      }),
    ).toThrow(/positive integer/);
  });

  it("factory rejects non-positive windowMs", () => {
    expect(() =>
      enforceRateLimit({
        limit: 5,
        windowMs: 0,
        store,
        auditLogger: stub.logger,
        endpoint: "test",
      }),
    ).toThrow(/positive integer/);
  });

  it("permits requests up to the limit and rejects the (limit+1)th", async () => {
    const app = makeApp(3, 60_000, store, stub.logger, "login");
    for (let i = 0; i < 3; i += 1) {
      const r = await app.inject({ method: "GET", url: "/probe" });
      expect(r.statusCode).toBe(200);
    }
    const r4 = await app.inject({ method: "GET", url: "/probe" });
    expect(r4.statusCode).toBe(429);
    const body = r4.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    // §8 anti-enumeration — generic, no count remaining.
    expect(body.error.message).toBe("Too many requests.");
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].action).toBe("rate_limit.triggered");
    expect(stub.calls[0].result).toBe("denied");
    expect(stub.calls[0].metadata?.denied_reason).toBe("window_exceeded");
    expect(stub.calls[0].metadata?.endpoint).toBe("login");
  });

  it("rejects when the principal is locked, even within window quota", async () => {
    let nowMs = 1_000_000;
    const app = makeApp(
      100,
      60_000,
      store,
      stub.logger,
      "login",
      undefined,
      () => nowMs,
    );
    // Key extractor will use req.ip — fastify supplies "127.0.0.1" via inject.
    await store.lockUntil("127.0.0.1", nowMs + 30_000);
    const r = await app.inject({ method: "GET", url: "/probe" });
    expect(r.statusCode).toBe(429);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].metadata?.denied_reason).toBe("locked");
    // Crucially: the lock check comes BEFORE the window hit, so the
    // bucket count must remain at 0.
    const peek = await store.peek("127.0.0.1", nowMs, 60_000);
    expect(peek.count).toBe(0);
  });

  it("lock expires once now > lockedUntilMs", async () => {
    let nowMs = 1_000_000;
    const app = makeApp(
      5,
      60_000,
      store,
      stub.logger,
      "login",
      undefined,
      () => nowMs,
    );
    await store.lockUntil("127.0.0.1", nowMs + 1_000);
    nowMs += 2_000; // past the lock
    const r = await app.inject({ method: "GET", url: "/probe" });
    expect(r.statusCode).toBe(200);
  });

  it("custom keyExtractor scopes per user (post-auth use)", async () => {
    const byHeader: RateLimitKeyExtractor = (req: FastifyRequest) =>
      String(req.headers["x-test-user"] ?? "anon");
    const app = makeApp(
      2,
      60_000,
      store,
      stub.logger,
      "approval-token",
      byHeader,
    );
    // user A: 2 hits OK
    for (let i = 0; i < 2; i += 1) {
      const r = await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-test-user": "user-a" },
      });
      expect(r.statusCode).toBe(200);
    }
    // user A: 3rd → 429
    const r3a = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-test-user": "user-a" },
    });
    expect(r3a.statusCode).toBe(429);
    // user B: independent bucket
    const r1b = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-test-user": "user-b" },
    });
    expect(r1b.statusCode).toBe(200);
  });

  it("sliding window evicts expired hits", async () => {
    let nowMs = 1_000_000;
    const app = makeApp(
      2,
      1_000,
      store,
      stub.logger,
      "test",
      undefined,
      () => nowMs,
    );
    expect(
      (await app.inject({ method: "GET", url: "/probe" })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/probe" })).statusCode,
    ).toBe(200);
    // Third within window → 429
    expect(
      (await app.inject({ method: "GET", url: "/probe" })).statusCode,
    ).toBe(429);
    // Slide past window — old hits evicted on next probe.
    nowMs += 1_500;
    expect(
      (await app.inject({ method: "GET", url: "/probe" })).statusCode,
    ).toBe(200);
  });

  it("X-Forwarded-For takes precedence over req.ip when present (default extractor)", async () => {
    let nowMs = 1_000_000;
    const app = makeApp(
      1,
      60_000,
      store,
      stub.logger,
      "test",
      undefined,
      () => nowMs,
    );
    // First request from 1.2.3.4 succeeds.
    const r1 = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(r1.statusCode).toBe(200);
    // Second from same XFF rejected.
    const r2 = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(r2.statusCode).toBe(429);
    // Different XFF → fresh bucket.
    const r3 = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-forwarded-for": "5.6.7.8" },
    });
    expect(r3.statusCode).toBe(200);
  });

  it("audit emission has zero rate-limit rows on the success path", async () => {
    const app = makeApp(5, 60_000, store, stub.logger, "test");
    for (let i = 0; i < 3; i += 1) {
      await app.inject({ method: "GET", url: "/probe" });
    }
    expect(stub.calls).toHaveLength(0);
  });
});

describe("InMemoryRateLimitStore", () => {
  it("clear() removes all state", async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit("k", 1000, 60_000);
    await store.lockUntil("k", 9_999_999);
    expect((await store.peek("k", 1000, 60_000)).count).toBe(1);
    store.clear();
    expect((await store.peek("k", 1000, 60_000)).count).toBe(0);
    expect((await store.peek("k", 1000, 60_000)).lockedUntilMs).toBe(0);
  });
});

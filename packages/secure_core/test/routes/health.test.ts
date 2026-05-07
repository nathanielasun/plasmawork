/**
 * L4.12 — health / readiness / metrics route tests.
 */

import { describe, it, expect } from "vitest";
import Fastify from "fastify";

import {
  healthRoutes,
  MetricsRegistry,
} from "../../src/routes/health.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";

function buildApp(opts: Parameters<typeof healthRoutes>[1]) {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requireRequestId);
  app.register(healthRoutes, opts);
  return app;
}

describe("L4.12 — health/readiness/metrics", () => {
  it("GET /health returns 200 + service + uptime_ms", async () => {
    const app = buildApp({ serviceVersion: "test@1.0.0" });
    const r = await app.inject({ method: "GET", url: "/health" });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; service: string; uptime_ms: number };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("test@1.0.0");
    expect(body.uptime_ms).toBeGreaterThanOrEqual(0);
  });

  it("GET /readiness returns 503 when no pool is wired", async () => {
    const app = buildApp({});
    const r = await app.inject({ method: "GET", url: "/readiness" });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, reason: "no_db_pool" });
  });

  it("GET /readiness returns 200 when SELECT 1 succeeds", async () => {
    const fakeSql = (() => Promise.resolve([{ ok: 1 }])) as never;
    const app = buildApp({
      appSql: fakeSql,
      serviceVersion: "test@1.0.0",
    });
    const r = await app.inject({ method: "GET", url: "/readiness" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, service: "test@1.0.0" });
  });

  it("GET /readiness returns 503 when the pool throws", async () => {
    const fakeSql = (() => Promise.reject(new Error("conn refused"))) as never;
    const app = buildApp({ appSql: fakeSql });
    const r = await app.inject({ method: "GET", url: "/readiness" });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, reason: "db_unreachable" });
  });

  it("GET /metrics returns Prometheus text format with built-in counters", async () => {
    const app = buildApp({ serviceVersion: "test@1.0.0" });
    const r = await app.inject({ method: "GET", url: "/metrics" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/plain");
    expect(r.body).toContain("secure_core_uptime_ms");
    expect(r.body).toContain("secure_core_memory_rss_bytes");
    expect(r.body).toContain('service="test@1.0.0"');
  });

  it("GET /metrics renders application counters from the MetricsRegistry", async () => {
    const reg = new MetricsRegistry();
    reg.inc("auth_failures_total", { reason: "csrf_failed" }, 3);
    reg.inc("auth_failures_total", { reason: "csrf_failed" }, 2);
    reg.inc("auth_failures_total", { reason: "session_expired" });
    const app = buildApp({ metricsRegistry: reg });
    const r = await app.inject({ method: "GET", url: "/metrics" });
    expect(r.body).toContain(
      'auth_failures_total{reason="csrf_failed"} 5',
    );
    expect(r.body).toContain(
      'auth_failures_total{reason="session_expired"} 1',
    );
  });

  it("MetricsRegistry refuses non-finite or negative increments", () => {
    const reg = new MetricsRegistry();
    expect(() => reg.inc("foo", {}, NaN)).toThrow(/non-negative finite/);
    expect(() => reg.inc("foo", {}, -1)).toThrow(/non-negative finite/);
    expect(() => reg.inc("foo", {}, Infinity)).toThrow(/non-negative finite/);
  });

  it("MetricsRegistry refuses invalid metric and label names", () => {
    const reg = new MetricsRegistry();
    expect(() => reg.inc("bad-name", {}, 1)).toThrow(/invalid metric name/);
    expect(() => reg.inc("good_name_total", { "bad-label": "x" })).toThrow(
      /invalid metric label/,
    );
  });

  it("MetricsRegistry escapes label values", () => {
    const reg = new MetricsRegistry();
    reg.inc("evil_total", { msg: 'has "quotes" and \\backslashes' });
    const text = reg.render();
    // Prometheus text format requires \\ → \\\\, " → \\"
    expect(text).toContain('msg="has \\"quotes\\" and \\\\backslashes"');
  });

  it("/metrics uses Prometheus text content-type", async () => {
    const app = buildApp({});
    const r = await app.inject({ method: "GET", url: "/metrics" });
    expect(r.headers["content-type"]).toContain("text/plain");
    expect(r.headers["content-type"]).toContain("version=0.0.4");
  });
});

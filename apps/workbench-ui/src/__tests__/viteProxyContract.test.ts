// @vitest-environment node
/**
 * Vite dev-server proxy contract test — Layer 3 of the cross-process
 * wiring test strategy (2026-05-10).
 *
 * The Vite dev server serves the SPA on :5173 and proxies API paths
 * to the gateway on :4000. Every prefix the UI client actually calls
 * MUST appear in ``vite.config.ts`` proxy table, and every entry MUST
 * target the gateway (NOT FastAPI on :8000).
 *
 * The original Vite-proxy regression was a single
 * ``"/api": "http://localhost:8000"`` entry: ``/api`` got forwarded
 * straight to FastAPI (bypassing the gateway entirely), and every
 * other prefix the UI calls — ``/auth/session``, ``/auth/login``,
 * ``/bootstrap``, ``/operator/*`` — hit the Vite dev server itself
 * and 404'd. The bug only surfaced when ``/auth/session`` ran (a
 * gateway-only path).
 *
 * This test reads ``vite.config.ts`` as a live module, walks its
 * ``server.proxy`` map, and asserts:
 *
 *   1. Each prefix the UI's two clients hit is present in the proxy.
 *   2. Every proxy value targets the same host:port (the gateway).
 *   3. No proxy value targets the FastAPI port (:8000).
 *   4. The gateway port is one we trust (4000 today).
 */

import { describe, expect, it } from "vitest";

import viteConfig from "../../vite.config.js";

// Every prefix the UI client actually calls. Sourced from:
//   - apps/workbench-ui/src/api/secureCoreClient.ts (auth + operator)
//   - apps/workbench-ui/src/api/client.ts (workspace-scoped /api/:slug/*)
// Kept in lockstep with the convention-checker section
// "Cross-process wiring (Vite ↔ gateway ↔ FastAPI)".
const REQUIRED_PROXY_PREFIXES = [
  "/auth",
  "/api",
  "/bootstrap",
  "/operator",
  "/workspaces",
  "/approvals",
] as const;

const EXPECTED_GATEWAY_TARGET = "http://localhost:4000";
const FORBIDDEN_FASTAPI_TARGET = "http://localhost:8000";

function getProxyTable(): Record<string, string | { target: string }> {
  const cfg = viteConfig as unknown as {
    server?: { proxy?: Record<string, string | { target: string }> };
  };
  const proxy = cfg.server?.proxy;
  if (!proxy) {
    throw new Error(
      "vite.config.ts has no server.proxy section; SPA cannot reach the gateway in dev.",
    );
  }
  return proxy;
}

function resolveTarget(value: string | { target: string }): string {
  return typeof value === "string" ? value : value.target;
}

describe("vite dev-server proxy contract", () => {
  it("declares every prefix the UI client calls", () => {
    const proxy = getProxyTable();
    const declared = new Set(Object.keys(proxy));
    for (const prefix of REQUIRED_PROXY_PREFIXES) {
      expect(
        declared,
        `vite.config.ts proxy is missing ${prefix}; the SPA's call would 404 against the Vite dev server (regression of the original auth/session bug)`,
      ).toContain(prefix);
    }
  });

  it("targets the gateway for every proxied prefix", () => {
    const proxy = getProxyTable();
    for (const prefix of REQUIRED_PROXY_PREFIXES) {
      const value = proxy[prefix];
      expect(value, `proxy[${prefix}] missing`).toBeTruthy();
      const target = resolveTarget(value);
      expect(
        target,
        `proxy[${prefix}] must target the gateway (${EXPECTED_GATEWAY_TARGET}); got ${target}`,
      ).toBe(EXPECTED_GATEWAY_TARGET);
    }
  });

  it("never bypasses the gateway to FastAPI directly", () => {
    const proxy = getProxyTable();
    for (const [prefix, value] of Object.entries(proxy)) {
      const target = resolveTarget(value);
      expect(
        target,
        `proxy[${prefix}] points at FastAPI (${target}); SPA would skip the gateway HMAC handoff entirely`,
      ).not.toBe(FORBIDDEN_FASTAPI_TARGET);
    }
  });

  it("targets a single consistent gateway host:port across the table", () => {
    // Catches "half the table points at :4000, half at :4001" drift
    // that could happen during a port-config refactor.
    const proxy = getProxyTable();
    const targets = new Set(
      Object.values(proxy).map((v) => resolveTarget(v)),
    );
    expect(targets.size, `vite proxy targets multiple hosts: ${[...targets].join(", ")}`).toBe(1);
  });
});

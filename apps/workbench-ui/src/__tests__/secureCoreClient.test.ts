/**
 * secureCoreClient tests — Phase 0.5 post-audit (2026-05-09).
 *
 * Pins the cross-cutting fetch invariants the gateway requires:
 *   1. Every request runs with ``credentials: "include"`` so the
 *      ``secure_session`` + ``csrf_token`` cookies ride along.
 *   2. State-changing requests (POST/PUT/PATCH/DELETE) echo the
 *      ``csrf_token`` cookie value as the ``X-CSRF-Token`` header
 *      — v4 §7.2 double-submit. The gateway's
 *      ``enforceCsrfForStateChange`` rejects these requests when the
 *      header is missing, so without this echo the previous logout
 *      flow silently 403'd while the UI redirected away regardless.
 *   3. Idempotent (GET/HEAD/OPTIONS) requests do NOT need the
 *      header — the middleware exempts them — and the client should
 *      not invent a value just to send one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSecureCoreClient } from "../api/secureCoreClient";

interface FetchCall {
  url: string;
  method: string;
  credentials: RequestCredentials | undefined;
  headers: Record<string, string>;
}

function captureFetch(): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers ?? {};
    if (raw instanceof Headers) {
      raw.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(raw)) {
      for (const [k, v] of raw) headers[k] = v;
    } else {
      Object.assign(headers, raw as Record<string, string>);
    }
    calls.push({
      url: String(url),
      method: (init?.method ?? "GET").toString().toUpperCase(),
      credentials: init?.credentials,
      headers,
    });
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { calls };
}

describe("secureCoreClient — cookie + CSRF wiring", () => {
  let originalCookie: string;

  beforeEach(() => {
    originalCookie = document.cookie;
    document.cookie =
      "csrf_token=raw_csrf_token_for_test; path=/";
  });

  afterEach(() => {
    document.cookie = "csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    if (originalCookie.length > 0) {
      // restore — this is best-effort because document.cookie is
      // additive, but it keeps the test isolation reasonable.
    }
    vi.restoreAllMocks();
  });

  it("login() POSTs with credentials:include AND X-CSRF-Token", async () => {
    const { calls } = captureFetch();
    const client = createSecureCoreClient("http://example.test");
    await client.login({ username: "rootadmin42x9k", password: "supersecret" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.credentials).toBe("include");
    expect(calls[0]!.headers["X-CSRF-Token"]).toBe("raw_csrf_token_for_test");
  });

  it("logout() POSTs with credentials:include AND X-CSRF-Token", async () => {
    const { calls } = captureFetch();
    const client = createSecureCoreClient("http://example.test");
    await client.logout();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.credentials).toBe("include");
    expect(calls[0]!.headers["X-CSRF-Token"]).toBe("raw_csrf_token_for_test");
  });

  it("currentSession() runs with credentials:include but does NOT include X-CSRF-Token (idempotent)", async () => {
    const { calls } = captureFetch();
    const client = createSecureCoreClient("http://example.test");
    await client.currentSession();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.credentials).toBe("include");
    expect(calls[0]!.headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("does not invent an X-CSRF-Token when the cookie is absent", async () => {
    document.cookie =
      "csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    const { calls } = captureFetch();
    const client = createSecureCoreClient("http://example.test");
    await client.logout();
    expect(calls[0]!.headers["X-CSRF-Token"]).toBeUndefined();
  });
});

/**
 * Tests for the backend-mode probe client.
 *
 * The probe returns one of three modes based on what /dev-status
 * responds with:
 *   200 → "stub" (dev stub gateway is responding)
 *   404 → "live" (real gateway, no /dev-status endpoint)
 *   anything else / network error → "error"
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeBackendMode } from "../api/devStatus.js";

function mockFetch(response: Response | (() => Promise<Response>)): void {
  const impl = typeof response === "function" ? response : () => Promise.resolve(response);
  vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("probeBackendMode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns mode="stub" with hint when /dev-status returns 200 + stub body', async () => {
    mockFetch(
      jsonResponse(200, {
        mode: "stub",
        started_at: "2026-05-12T00:00:00Z",
        hint: "Run scripts/dev/run_gateway.sh for real auth.",
      }),
    );
    const status = await probeBackendMode();
    expect(status.mode).toBe("stub");
    expect(status.hint).toBe("Run scripts/dev/run_gateway.sh for real auth.");
    expect(status.error).toBeNull();
  });

  it('returns mode="live" when /dev-status returns 404 (real gateway has no probe)', async () => {
    mockFetch(jsonResponse(404, { error: "not_found" }));
    const status = await probeBackendMode();
    expect(status.mode).toBe("live");
    expect(status.hint).toBeNull();
    expect(status.error).toBeNull();
  });

  it('returns mode="error" on a network failure', async () => {
    mockFetch(() => Promise.reject(new TypeError("ECONNREFUSED")));
    const status = await probeBackendMode();
    expect(status.mode).toBe("error");
    expect(status.error).toContain("ECONNREFUSED");
    expect(status.hint).toBeNull();
  });

  it('returns mode="error" on an unexpected status (e.g. 500)', async () => {
    mockFetch(jsonResponse(500, { error: "server_explode" }));
    const status = await probeBackendMode();
    expect(status.mode).toBe("error");
    expect(status.error).toContain("500");
  });

  it("propagates AbortError without converting to error mode", async () => {
    const abortErr = new DOMException("aborted", "AbortError");
    mockFetch(() => Promise.reject(abortErr));
    await expect(probeBackendMode()).rejects.toBe(abortErr);
  });

  it("treats a 200 with non-JSON body as error mode", async () => {
    mockFetch(
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const status = await probeBackendMode();
    expect(status.mode).toBe("error");
    expect(status.error).toContain("non-JSON");
  });
});

/**
 * client.ts workspace-prefix + CSRF + credentials tests —
 * Phase 0.5 / Phase F-rest-final (2026-05-09).
 *
 * Pins four contracts on the legacy fetch helper:
 *   1. With a workspace slug set, requests go to /api/{slug}/{path}.
 *   2. With slug = null, requests fall back to /api/{path} (no prefix).
 *   3. State-changing methods echo X-CSRF-Token from the cookie.
 *   4. GET requests do NOT echo X-CSRF-Token.
 *
 * The test uses ``createApiClient`` so it exercises the same code
 * path the rest of the UI does, rather than poking at fetchJson
 * directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../api/client";
import {
  getCurrentWorkspaceSlug,
  setCurrentWorkspaceSlug,
} from "../api/workspaceContext";

interface CapturedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly credentials: RequestCredentials | undefined;
}

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/`;
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function captureFetch(): {
  readonly calls: CapturedCall[];
  readonly stub: ReturnType<typeof vi.fn>;
} {
  const calls: CapturedCall[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headersRecord: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) headersRecord[k] = h[k]!;
    }
    calls.push({
      url: typeof input === "string" ? input : input.toString(),
      method: (init?.method ?? "GET").toUpperCase(),
      headers: headersRecord,
      credentials: init?.credentials,
    });
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", stub);
  return { calls, stub };
}

describe("client.ts workspace prefix + CSRF + credentials", () => {
  beforeEach(() => {
    setCurrentWorkspaceSlug(null);
    clearCookie("csrf_token");
  });

  afterEach(() => {
    setCurrentWorkspaceSlug(null);
    clearCookie("csrf_token");
    vi.unstubAllGlobals();
  });

  it("setCurrentWorkspaceSlug round-trips through getCurrentWorkspaceSlug", () => {
    expect(getCurrentWorkspaceSlug()).toBeNull();
    setCurrentWorkspaceSlug("foo");
    expect(getCurrentWorkspaceSlug()).toBe("foo");
    setCurrentWorkspaceSlug(null);
    expect(getCurrentWorkspaceSlug()).toBeNull();
    setCurrentWorkspaceSlug("");
    // Empty string is normalized to null so callers never accidentally
    // produce ``/api//capsules`` (the gateway would 404 it anyway).
    expect(getCurrentWorkspaceSlug()).toBeNull();
  });

  it("prefixes /api/{slug}/{path} when a slug is active", async () => {
    const { calls } = captureFetch();
    setCurrentWorkspaceSlug("shared-public-experiments");
    const client = createApiClient();
    await client.listCapsules();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/shared-public-experiments/capsules");
  });

  it("falls back to /api/{path} when no slug is set", async () => {
    const { calls } = captureFetch();
    setCurrentWorkspaceSlug(null);
    const client = createApiClient();
    await client.listCapsules();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/capsules");
  });

  it("uses credentials: include on every fetch", async () => {
    const { calls } = captureFetch();
    setCurrentWorkspaceSlug("ws-a");
    const client = createApiClient();
    await client.listCapsules();
    await client.startRun({ model_yaml_path: "examples/x/model.yaml" });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.credentials).toBe("include");
    }
  });

  it("echoes X-CSRF-Token on POST when the cookie is set", async () => {
    const { calls } = captureFetch();
    setCookie("csrf_token", "raw-csrf-test-token");
    const client = createApiClient();
    await client.startRun({ model_yaml_path: "examples/x/model.yaml" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["X-CSRF-Token"]).toBe("raw-csrf-test-token");
  });

  it("does NOT echo X-CSRF-Token on GET", async () => {
    const { calls } = captureFetch();
    setCookie("csrf_token", "raw-csrf-test-token");
    const client = createApiClient();
    await client.listCapsules();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("omits the X-CSRF-Token header when the cookie is empty (caller will 4xx, not crash)", async () => {
    const { calls } = captureFetch();
    // No cookie set in beforeEach.
    const client = createApiClient();
    await client.startRun({ model_yaml_path: "examples/x/model.yaml" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers["X-CSRF-Token"]).toBeUndefined();
  });
});

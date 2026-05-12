/**
 * Vite-dev proxy wiring — Layer 5 (Playwright E2E).
 *
 * The Layer 3 vitest catches missing/wrong proxy entries by inspecting
 * the vite.config.ts AST. But the original regression had a subtler
 * failure mode: vite-dev's default SPA fallback served the bundled
 * index.html (200 + text/html) for /auth/session — the browser's
 * fetch saw a 200 with HTML body and the SPA produced "Secure-core
 * /auth/session failed with HTTP 404" when trying to parse the
 * response. A true E2E test needs a real browser hitting real
 * vite-dev.
 *
 * Stack:
 *   - Stub gateway on :4000 (e2e/stubGateway.mjs) — returns 401 JSON
 *     for /auth/session, 200 JSON for /api/<slug>/health, 404 for
 *     anything the vite proxy didn't forward.
 *   - vite-dev on :5173 with the real apps/workbench-ui/vite.config.ts
 *     proxy table.
 *
 * If vite proxies correctly: every test passes — the stub answers,
 * the browser sees JSON.
 * If a vite proxy entry is missing: vite-dev's SPA fallback serves
 * index.html, content-type is text/html, the test fails with a
 * specific diagnostic ("expected JSON, got HTML").
 */

import { expect, test } from "@playwright/test";

test.describe("vite dev-server proxy actually forwards to the gateway", () => {
  test("GET /auth/session returns gateway JSON 401 (not SPA HTML)", async ({
    request,
  }) => {
    const r = await request.get("/auth/session");
    expect(
      r.status(),
      "/auth/session should be proxied to gateway (which returns 401), not served as SPA HTML by vite-dev",
    ).toBe(401);
    const ct = r.headers()["content-type"] ?? "";
    expect(
      ct,
      "vite proxy must forward /auth/session to the gateway; HTML response means vite served the SPA fallback (the original regression)",
    ).toMatch(/application\/json/);
  });

  test("GET /api/<slug>/health passes through to the (stub) gateway", async ({
    request,
  }) => {
    const r = await request.get("/api/shared-public-experiments/health");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ proxy: "stub-gateway" });
  });

  test("GET /bootstrap, /operator/*, /workspaces, /approvals all reach the gateway", async ({
    request,
  }) => {
    for (const path of [
      "/bootstrap",
      "/operator/security-dashboard",
      "/workspaces",
      "/approvals/some-id",
    ]) {
      const r = await request.get(path);
      // The stub returns 401 JSON for any of these; vite-dev's SPA
      // fallback would return 200 HTML. Any 401 JSON proves the
      // proxy forwarded.
      expect(r.status(), `${path} not proxied to gateway`).toBe(401);
      expect(
        r.headers()["content-type"] ?? "",
        `${path} returned content-type other than JSON — vite served the SPA fallback`,
      ).toMatch(/application\/json/);
    }
  });

  test("vite-dev serves the SPA at /", async ({ page }) => {
    // Sanity check: paths NOT in the proxy table get the SPA shell.
    // This confirms the dev server is healthy and the test wasn't
    // accidentally hitting the stub directly.
    const r = await page.goto("/");
    expect(r?.status(), "/ should load the SPA").toBe(200);
    const ct = r?.headers()["content-type"] ?? "";
    expect(ct).toMatch(/text\/html/);
  });

  test("BackendStatusBanner renders the stub banner against the stub gateway", async ({
    page,
  }) => {
    // /dev-status is proxied through vite to the stub which returns
    // mode: "stub". The BackendStatusBanner reads that and renders
    // an aria role="status" element with data-mode="stub".
    await page.goto("/");
    const banner = page.locator('[role="status"][data-mode]');
    await banner.first().waitFor({ state: "visible", timeout: 5_000 });
    // Banner displays the stub label + hint from the stub body.
    await expect(banner.first()).toHaveAttribute("data-mode", "stub");
    await expect(banner.first()).toContainText("Dev stub gateway");
  });
});

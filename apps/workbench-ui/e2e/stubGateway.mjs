/**
 * Stub gateway for Layer 5 (Playwright E2E).
 *
 * The vite dev server proxies /auth/*, /api/*, /bootstrap, /operator/*,
 * /workspaces/*, /approvals/* to localhost:4000. The real gateway
 * (apps/workbench-gateway) requires postgres + bootstrap admin + a
 * full .env.auth to boot; that's deliberately out of scope for the
 * proxy-wiring test. This stub returns the responses the real gateway
 * would emit for these prefixes so the test asserts on the proxy's
 * forwarding behavior, not on the auth subsystem.
 *
 * Specifically:
 *   GET /auth/session → 401 application/json
 *   GET /api/<slug>/health → 200 application/json
 *   anything else → 404
 *
 * Run as: node e2e/stubGateway.mjs
 */

import { createServer } from "node:http";

const PORT = Number(process.env.STUB_GATEWAY_PORT ?? 4000);

const server = createServer((req, res) => {
  const url = req.url ?? "";
  const sendJson = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (url === "/dev-status") {
    // Mirrors the dev stub's /dev-status. The BackendStatusBanner
    // tested by Layer 5 (proxyWiring.spec.ts) sees mode="stub" here.
    sendJson(200, {
      mode: "stub",
      hint: "Layer 5 stub gateway (test fixture).",
    });
    return;
  }
  if (url.startsWith("/auth/session")) {
    sendJson(401, { error: "unauthenticated", code: "no_session" });
    return;
  }
  if (url.startsWith("/api/") && url.includes("/health")) {
    sendJson(200, { status: "ok", proxy: "stub-gateway" });
    return;
  }
  if (url.startsWith("/auth/login")) {
    sendJson(400, { error: "stub-gateway: login not implemented" });
    return;
  }
  if (
    url.startsWith("/api/") ||
    url.startsWith("/bootstrap") ||
    url.startsWith("/operator") ||
    url.startsWith("/workspaces") ||
    url.startsWith("/approvals")
  ) {
    // Any other proxied path that reached the stub gets a generic
    // 401 — the canonical "vite proxy did forward; gateway refused"
    // response shape. The test asserts content-type is JSON, not
    // HTML — that's enough to distinguish "vite forwarded" from
    // "vite served the SPA fallback".
    sendJson(401, { error: "unauthenticated" });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`stubGateway listening on http://127.0.0.1:${PORT}`);
});

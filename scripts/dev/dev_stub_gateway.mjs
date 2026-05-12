#!/usr/bin/env node
/**
 * Development stub gateway — Phase 0.5 dev convenience (2026-05-10).
 *
 * The real workbench-gateway requires postgres + .env.auth +
 * bootstrap admin. That's the right model for production, but it's
 * heavy for "I just want to dev the UI/backend" workflows. This stub
 * is a zero-config gateway that:
 *
 *   - GET  /auth/session  → 200 if a stub session cookie is set, else 401.
 *   - POST /auth/login    → mints a stub session + csrf cookies, 200.
 *   - POST /auth/logout   → clears the cookies, 200.
 *   - GET  /api/*         → reverse-proxies to FastAPI on :8000 with no
 *                           handoff headers (FastAPI's dev-mode fallback
 *                           treats it as the default workspace).
 *   - Other /auth/*, /bootstrap, /operator/*, /workspaces, /approvals →
 *                           401 JSON (clearly stub-shaped).
 *
 * Anything that the SPA fetches from "the gateway" is answered. The
 * user can log in with any credentials, use the UI, and call /api/*
 * endpoints. There is NO real auth — DO NOT use this against a real
 * deployment, ever. The startup banner is loud about that.
 *
 * For full auth (HMAC handoff, real session DB, etc.) run the real
 * gateway via `scripts/dev/run_gateway.sh`.
 *
 * Run as: node scripts/dev/dev_stub_gateway.mjs
 * Or:     bash scripts/dev/run_dev_stub_gateway.sh
 */

import http from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.WORKBENCH_GATEWAY_PORT ?? 4000);
const BACKEND_HOST = "127.0.0.1";
const BACKEND_PORT = Number(process.env.WORKBENCH_BACKEND_PORT ?? 8000);

// In-memory session store — restarting this process wipes every "login".
const SESSIONS = new Map();

// Process start time for the /dev-status probe.
const STARTED_AT = new Date().toISOString();

const STUB_USER_ID = "00000000-0000-4000-8000-000000000001";
const STUB_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
const STUB_WORKSPACE_SLUG = "shared-public-experiments";

function readCookies(req) {
  const out = {};
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out[trimmed.slice(0, eq)] = decodeURIComponent(trimmed.slice(eq + 1));
  }
  return out;
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function stubSessionResponse() {
  return {
    user_id: STUB_USER_ID,
    session_id: "00000000-0000-4000-8000-000000000003",
    actor_type: "human",
    assurance_level: "aal2",
    memberships: [
      {
        workspace_id: STUB_WORKSPACE_ID,
        workspace_name: STUB_WORKSPACE_SLUG,
        role_id: "00000000-0000-4000-8000-000000000004",
        role_name: "WorkspaceAdmin",
        capabilities: [
          "capsule:read",
          "capsule:update",
          "run:create",
          "tool:read",
          "tool:create",
          "tool:update",
          "tool:request_promotion",
        ],
      },
    ],
  };
}

function proxyToBackend(req, res) {
  // Strip the slug from /api/<slug>/<rest> so the FastAPI's flat
  // /api/<rest> routes still match. Matches what the real gateway's
  // preRewrite does in apps/workbench-gateway/src/proxy/workbenchProxy.ts.
  //
  // Only strip when there IS a /<rest> after the slug. A bare
  // /api/<word> path (e.g. /api/health hit directly) must NOT lose
  // its tail — otherwise FastAPI's bypass endpoints 404.
  const slugPrefixed = req.url.match(/^\/api\/[A-Za-z0-9_-]{3,64}(\/.+)/);
  const upstreamUrl = slugPrefixed ? `/api${slugPrefixed[1]}` : req.url;

  const upstream = http.request(
    {
      host: BACKEND_HOST,
      port: BACKEND_PORT,
      method: req.method,
      path: upstreamUrl,
      headers: {
        ...req.headers,
        host: `${BACKEND_HOST}:${BACKEND_PORT}`,
      },
    },
    (backendRes) => {
      res.writeHead(backendRes.statusCode ?? 502, backendRes.headers);
      backendRes.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    sendJson(res, 502, {
      error: "dev-stub-gateway: backend unreachable",
      detail: err.message,
      hint: "Is scripts/dev/run_backend.sh running on :" + BACKEND_PORT + "?",
    });
  });
  req.pipe(upstream);
}

function setSessionCookies(res, sessionToken, csrfToken) {
  // Two cookies, matching the real gateway's contract:
  //   secure_session: HttpOnly, used by the gateway/SPA to identify session.
  //   csrf_token: non-HttpOnly so the SPA can read it via document.cookie
  //               and echo as X-CSRF-Token.
  res.setHeader("set-cookie", [
    `secure_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax`,
    `csrf_token=${csrfToken}; Path=/; SameSite=Lax`,
  ]);
}

function clearSessionCookies(res) {
  res.setHeader("set-cookie", [
    "secure_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    "csrf_token=; Path=/; SameSite=Lax; Max-Age=0",
  ]);
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "";
  const method = req.method ?? "GET";

  try {
    // ---------------------------------------------------------------
    // /dev-status — probe endpoint for the SPA's BackendStatusBanner.
    // The real gateway does NOT implement this route (404 = "live");
    // a 200 with mode="stub" tells the SPA it's running against the
    // dev stub. No auth required (the response carries no secrets).
    // ---------------------------------------------------------------
    if (method === "GET" && url === "/dev-status") {
      sendJson(res, 200, {
        mode: "stub",
        started_at: STARTED_AT,
        hint: "Dev stub gateway. Run scripts/dev/run_gateway.sh (or run_dev.sh --real) for the real auth surface.",
      });
      return;
    }

    // ---------------------------------------------------------------
    // /auth/session — check the session cookie.
    // ---------------------------------------------------------------
    if (method === "GET" && url.startsWith("/auth/session")) {
      const { secure_session } = readCookies(req);
      if (!secure_session || !SESSIONS.has(secure_session)) {
        sendJson(res, 401, {
          error: "unauthenticated",
          code: "no_session",
          stub: true,
        });
        return;
      }
      sendJson(res, 200, stubSessionResponse());
      return;
    }

    // ---------------------------------------------------------------
    // /auth/login — mint a stub session.
    // ---------------------------------------------------------------
    if (method === "POST" && url.startsWith("/auth/login")) {
      const body = await readBody(req);
      // Accept ANY username + password — this is dev-only.
      if (!body.username || !body.password) {
        sendJson(res, 400, {
          error: "stub-gateway: username + password required",
          stub: true,
        });
        return;
      }
      const sessionToken = randomBytes(32).toString("hex");
      const csrfToken = randomBytes(32).toString("hex");
      SESSIONS.set(sessionToken, { csrfToken, username: body.username });
      setSessionCookies(res, sessionToken, csrfToken);
      sendJson(res, 200, {
        user_id: STUB_USER_ID,
        session_id: "00000000-0000-4000-8000-000000000003",
        assurance_level: "aal2",
        csrf_token: csrfToken,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      return;
    }

    // ---------------------------------------------------------------
    // /auth/logout — clear cookies + revoke session.
    // ---------------------------------------------------------------
    if (method === "POST" && url.startsWith("/auth/logout")) {
      const { secure_session } = readCookies(req);
      if (secure_session) SESSIONS.delete(secure_session);
      clearSessionCookies(res);
      sendJson(res, 200, { status: "ok", stub: true });
      return;
    }

    // ---------------------------------------------------------------
    // /api/* — reverse-proxy to FastAPI in dev mode.
    // ---------------------------------------------------------------
    if (url.startsWith("/api/")) {
      proxyToBackend(req, res);
      return;
    }

    // ---------------------------------------------------------------
    // Everything else the SPA might call — return 501 stub.
    //
    // 501 Not Implemented (rather than 401) because the user IS
    // authenticated under the stub session — the route just isn't
    // implemented by the stub. 401 would mislead the SPA's error UX
    // into suggesting a session problem when there isn't one. Real
    // /operator/*, /bootstrap, /workspaces, /approvals routes ship in
    // the secure_core gateway.
    // ---------------------------------------------------------------
    if (
      url.startsWith("/auth/") ||
      url.startsWith("/bootstrap") ||
      url.startsWith("/operator") ||
      url.startsWith("/workspaces") ||
      url.startsWith("/approvals")
    ) {
      sendJson(res, 501, {
        error: "stub-gateway: route not implemented",
        path: url,
        stub: true,
        hint: "For real auth + the full secure_core surface, run scripts/dev/run_gateway.sh instead.",
      });
      return;
    }

    sendJson(res, 404, { error: "not_found", path: url, stub: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[dev-stub-gateway] handler error:", err);
    sendJson(res, 500, {
      error: "dev-stub-gateway: internal error",
      detail: String(err),
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  /* eslint-disable no-console */
  console.log("");
  console.log("================================================================");
  console.log("  dev-stub-gateway listening on http://127.0.0.1:" + PORT);
  console.log("");
  console.log("  This is a ZERO-AUTH stub for development convenience.");
  console.log("  DO NOT expose this process to anything except localhost.");
  console.log("");
  console.log("  Stub behavior:");
  console.log("    /auth/login    → accepts ANY username + password");
  console.log("    /auth/session  → 200 stub session when cookie is set");
  console.log("    /api/*         → reverse-proxy to FastAPI :" + BACKEND_PORT);
  console.log("    /bootstrap, /operator, /workspaces, /approvals → 401 stub");
  console.log("");
  console.log("  For real auth, run scripts/dev/run_gateway.sh instead.");
  console.log("================================================================");
  console.log("");
  /* eslint-enable no-console */
});

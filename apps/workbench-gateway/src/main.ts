/**
 * Workbench gateway entrypoint — Phase 0.5 (2026-05-09).
 *
 * The gateway is the public entry point of the workbench. Browsers
 * hit it directly; the FastAPI backend binds 127.0.0.1 only and is
 * reachable exclusively via the Phase E `/api/*` proxy plugin.
 *
 * Boot sequence:
 *
 *   1. Load + validate `.env.auth` (env.ts).
 *   2. Open two postgres-js clients (app + audit pools).
 *   3. Build secure_core services + middleware bundles.
 *   4. Build the Fastify app via `secure_core.buildApp()`.
 *   5. Register the auth-vertical route plugins:
 *        loginRoutes  → POST /auth/login + /auth/logout
 *        sessionRoutes → GET  /auth/session
 *        bootstrapRoutes → POST /bootstrap (only when gates are open)
 *   6. (Phase E2 — next commit) register `workbenchProxyPlugin` LAST
 *        so its `/api/*` catch-all does NOT shadow secure_core routes.
 *
 * Failure modes are intentionally fail-closed: missing env, mis-sized
 * secrets, malformed `BOOTSTRAP_CREDENTIAL_HASH`, an absent `.env.auth`
 * file — all surface at boot, not at first request.
 */

import postgres from "postgres";

import { buildApp } from "../../../packages/secure_core/src/server.js";
import { loginRoutes } from "../../../packages/secure_core/src/routes/login.js";
import { sessionRoutes } from "../../../packages/secure_core/src/routes/session.js";
import { bootstrapRoutes } from "../../../packages/secure_core/src/routes/bootstrap.js";
import type { FastifyInstance } from "fastify";

import { loadGatewayEnv, type GatewayEnv } from "./env.js";
import {
  buildGatewayServices,
  type GatewayServices,
} from "./services/composeServices.js";
import {
  buildGatewayMiddleware,
  ipKeyExtractor,
  type GatewayMiddlewareBundles,
} from "./middleware/bundles.js";

export interface BuiltGateway {
  readonly env: GatewayEnv;
  readonly app: FastifyInstance;
  readonly services: GatewayServices;
  readonly mw: GatewayMiddlewareBundles;
  readonly close: () => Promise<void>;
}

export interface BuildGatewayOptions {
  /** Override for tests — pre-loaded env values. */
  readonly env?: GatewayEnv;
  /**
   * Override for tests — pre-built services. When omitted the gateway
   * opens its own postgres-js clients per `env.dbUrl`/`env.dbAuditUrl`.
   */
  readonly services?: GatewayServices;
  /**
   * Override for tests — when true the cookie writer accepts plain
   * HTTP (so the test client doesn't have to terminate TLS). Defaults
   * to `false`; production never sets this.
   */
  readonly cookieSecure?: boolean;
}

/**
 * Build the gateway. Exposed as a function so tests can stand up the
 * app without listening on a real port.
 */
export async function buildGateway(
  opts: BuildGatewayOptions = {},
): Promise<BuiltGateway> {
  const env = opts.env ?? loadGatewayEnv();

  let services: GatewayServices;
  let ownsPools = false;
  if (opts.services !== undefined) {
    services = opts.services;
  } else {
    // ADR-0010: two pools — the app pool runs `secure_core_app`-shaped
    // work, the audit pool is the separate hash-chained writer.
    const appSql = postgres(env.dbUrl);
    const auditSql = postgres(env.dbAuditUrl);
    services = buildGatewayServices({ env, appSql, auditSql });
    ownsPools = true;
  }

  const app = buildApp({
    appSql: services.appPool.sql,
    cookieSecret: env.cookieSecret,
    errorMapping: { dev: false },
  });

  const mw = buildGatewayMiddleware({
    auditLogger: services.auditLogger,
    appPool: services.appPool,
    allowedOrigins: [env.frontendOrigin],
  });

  // Auth-vertical route registrations. The plugin order does not
  // affect correctness because each plugin owns a distinct path
  // prefix, but we register login → session → bootstrap to match the
  // user journey (sign in → check session → first-boot bootstrap).
  await app.register(loginRoutes, {
    service: services.loginService,
    mw: mw.login,
    cookieSecure: opts.cookieSecure ?? true,
  });
  await app.register(sessionRoutes, {
    service: services.sessionReader,
    mw: mw.session,
  });
  await app.register(bootstrapRoutes, {
    service: services.bootstrapService,
    mw: mw.bootstrap,
    auditLogger: services.auditLogger,
    bootstrapAllowed: env.bootstrapAllowed,
    wormMarker: services.wormMarker,
    rateLimitStore: mw.rateLimitStore,
    rateLimitKeyExtractor: ipKeyExtractor,
  });

  // TODO Phase E2: register `workbenchProxyPlugin` LAST. The proxy
  // mounts a catch-all at `/api/*`; registering it before the routes
  // above would shadow them. Phase E5 + F also depend on this.

  return {
    env,
    app,
    services,
    mw,
    async close() {
      await app.close();
      if (ownsPools) {
        // Only end the postgres-js clients we opened. Tests that
        // injected pre-built services own their own clients and clean
        // up themselves.
        await services.appPool.sql.end({ timeout: 5 });
        await services.auditPool.sql.end({ timeout: 5 });
      }
    },
  };
}

/**
 * Top-level entry. `npm run dev` (or `node --import tsx/esm src/main.ts`
 * after install) calls this. Errors at startup are surfaced verbatim
 * because the gateway is intentionally fail-closed at boot.
 */
export async function start(): Promise<void> {
  const gateway = await buildGateway();
  await gateway.app.listen({
    host: "0.0.0.0",
    port: gateway.env.gatewayPort,
  });
  gateway.app.log.info(
    `workbench-gateway listening on :${gateway.env.gatewayPort} (proxying /api → 127.0.0.1:${gateway.env.backendPort})`,
  );
}

const isDirect =
  typeof import.meta.url === "string" &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirect) {
  start().catch((err: unknown) => {
    // Boot-time failure — print and exit nonzero. The operator's
    // first cue that .env.auth needs attention.
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

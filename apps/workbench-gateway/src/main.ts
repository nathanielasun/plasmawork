/**
 * Workbench gateway entrypoint — Phase 0.5 (2026-05-09).
 *
 * Phase D scaffolding lands here: env loading + the secure_core
 * `buildApp` factory. The actual route registrations + the Phase E
 * `workbenchProxyPlugin` are in `src/proxy/workbenchProxy.ts` (added
 * in the next commit) and `src/services/composeServices.ts` (the
 * route plugin wiring).
 *
 * Today this file is intentionally a thin shell: it loads + validates
 * `.env.auth`, builds the Fastify app via secure_core's factory, and
 * fails to start if any required variable is missing. Routes are
 * still being wired as Phase D/E ship.
 *
 * To run during development:
 *   1. Copy /.env.auth.example → /.env.auth and fill the required
 *      values (see the comments at the top of the example).
 *   2. From the repo root: npm --prefix apps/workbench-gateway run dev
 */

import postgres from "postgres";

import { buildApp } from "../../../packages/secure_core/src/server.js";
import { loadGatewayEnv } from "./env.js";

export interface BuiltGateway {
  readonly env: ReturnType<typeof loadGatewayEnv>;
  readonly app: ReturnType<typeof buildApp>;
  readonly close: () => Promise<void>;
}

/**
 * Build the gateway. Exposed as a function so tests can stand up the
 * app without listening on a real port.
 */
export function buildGateway(opts?: {
  /** Override for tests — pre-loaded env values. */
  readonly env?: ReturnType<typeof loadGatewayEnv>;
}): BuiltGateway {
  const env = opts?.env ?? loadGatewayEnv();

  // Two pools per ADR-0010: the app pool runs `secure_core_app`-shaped
  // work, the audit pool is the separate hash-chained writer.
  const appSql = postgres(env.dbUrl);
  const auditSql = postgres(env.dbAuditUrl);

  const app = buildApp({
    appSql,
    cookieSecret: env.cookieSecret,
    errorMapping: { dev: false },
  });

  // TODO Phase D: register secure_core route plugins (login, auth,
  // workspaces, capsules, runs, tools, operator, security-dashboard,
  // bootstrap, sessions). Phase E adds the workbench proxy.
  //
  // Each route registration takes a service constructed in
  // `services/composeServices.ts` (next commit) plus a middleware
  // bundle from `middleware/bundles.ts`. The proxy plugin lives at
  // `proxy/workbenchProxy.ts` and is registered LAST so its catch-all
  // /api/* doesn't shadow the secure_core routes.

  return {
    env,
    app,
    async close() {
      await app.close();
      await appSql.end({ timeout: 5 });
      await auditSql.end({ timeout: 5 });
    },
  };
}

/**
 * Top-level entry. `npm run dev` (or `node --import tsx/esm src/main.ts`
 * after install) calls this. Errors at startup are surfaced verbatim
 * because the gateway is intentionally fail-closed at boot.
 */
export async function start(): Promise<void> {
  const gateway = buildGateway();
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

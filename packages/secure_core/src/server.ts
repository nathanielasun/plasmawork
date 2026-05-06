/**
 * Fastify app factory — Phase 0.5 Layer 2.
 *
 * `buildApp(deps)` constructs the secure_core HTTP service with:
 *
 *   - `requireRequestId` registered globally so every request, even
 *     ones rejected by the schema validator, has an id;
 *   - the L1.4 error mapper wired in via `setErrorHandler` so every
 *     thrown `SecureCoreError` becomes the §3 envelope shape;
 *   - `@fastify/cookie` registered for `requireAuth` + CSRF middleware
 *     to consume;
 *   - JSON-only body parsing with size limit (overflows surface as
 *     `INPUT_INVALID`).
 *
 * Routes are NOT registered here. Layer 4 ships per-resource route
 * plugins that import the L2 middleware and `composeMiddleware()`.
 *
 * `deps` is passed to every middleware that needs DB access; the
 * factory does not own pool lifecycle.
 */

import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { Sql } from "postgres";

import "./middleware/fastify_augment.js";
import { requireRequestId } from "./middleware/requireRequestId.js";
import {
  toHttpResponse,
  type ToHttpResponseOptions,
} from "./errors/mapper.js";
import { SecureCoreError } from "./errors/shapes.js";
import { readSecureCoreEnv } from "./secrets/env.js";

export interface BuildAppDeps {
  /** App-role pool. Routes that touch the audit pool inject it themselves. */
  appSql: Sql;
  /** Forwarded to `toHttpResponse`. Set `mode: "production"` in deployed services. */
  errorMapping?: ToHttpResponseOptions;
  /** Cookie signing secret. REQUIRED if any cookie is signed. */
  cookieSecret?: string;
  /**
   * Body size limit in bytes. Defaults to 1 MiB; routes that accept
   * larger payloads (worker uploads in L4.11) override per-route.
   */
  bodyLimitBytes?: number;
}

export function buildApp(deps: BuildAppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: readSecureCoreEnv("SECURE_CORE_LOG_LEVEL") ?? "info" },
    bodyLimit: deps.bodyLimitBytes ?? 1024 * 1024,
    // Disable Fastify's auto request-id; we mint our own UUIDv7.
    genReqId: () => "pending",
    requestIdHeader: false,
    requestIdLogLabel: "requestId",
  });

  app.decorate("appSql", deps.appSql);

  app.register(cookie, {
    secret: deps.cookieSecret,
    parseOptions: { sameSite: "lax", httpOnly: true, secure: true },
  });

  app.addHook("onRequest", requireRequestId);

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.requestId ?? "unknown";
    const mapped = toHttpResponse(
      err instanceof SecureCoreError ? err : err,
      requestId,
      deps.errorMapping,
    );
    reply.code(mapped.status).send(mapped.body);
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    appSql: Sql;
  }
}

/**
 * Middleware bundles for the workbench-gateway — Phase 0.5 / Phase D
 * (2026-05-09).
 *
 * Pre-composes the per-route middleware bundles that the secure_core
 * route plugins consume. v4 §6.2 fixes the strict ordering
 * (requireRequestId → enforceRateLimit → enforceCsrfForStateChange
 * → validateInputSchema → requireAuth → loadWorkspace
 * → requireWorkspaceMembership → attachAuditActor → handler) and
 * `composeMiddleware` enforces it at registration time. Each bundle
 * here returns the SUBSET each route plugin asks for; the plugin itself
 * calls `composeMiddleware` internally with the right ordering.
 *
 * The factories take a single shared `RateLimitStore` so the same IP
 * can't game the limiter by hopping between routes; production swaps
 * the in-memory store for a Redis-backed one without touching this file.
 */
import type { FastifyRequest } from "fastify";

import type { LoginRoutesMiddleware } from "../../../../packages/secure_core/src/routes/login.js";
import type { SessionRoutesMiddleware } from "../../../../packages/secure_core/src/routes/session.js";
import type { BootstrapRoutesMiddleware } from "../../../../packages/secure_core/src/routes/bootstrap.js";
import type { NamedMiddleware } from "../../../../packages/secure_core/src/middleware/compose.js";
import type { AuditLogger } from "../../../../packages/secure_core/src/audit/logger.js";
import type { RateLimitStore } from "../../../../packages/secure_core/src/middleware/enforceRateLimit.js";
import {
  enforceRateLimit,
  InMemoryRateLimitStore,
} from "../../../../packages/secure_core/src/middleware/enforceRateLimit.js";
import { enforceCsrfForStateChange } from "../../../../packages/secure_core/src/middleware/enforceCsrfForStateChange.js";
import { validateInputSchema } from "../../../../packages/secure_core/src/middleware/validateInputSchema.js";
import { attachAuditActor } from "../../../../packages/secure_core/src/middleware/attachAuditActor.js";
import { requireAuth } from "../../../../packages/secure_core/src/middleware/requireAuth.js";
import {
  LOGIN_SCHEMA,
  LOGOUT_SCHEMA,
} from "../../../../packages/secure_core/src/routes/login.js";
import type { SecureCorePool } from "../../../../packages/secure_core/src/db/pool.js";

/**
 * Per-IP key extractor. Identical to the secure_core
 * `enforceRateLimit` default; we re-declare here so the gateway can
 * pass it to `bootstrapRoutes` (which takes the extractor explicitly
 * so the limiter and the lockout move in lockstep).
 */
export const ipKeyExtractor = (req: FastifyRequest): string => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip;
};

export interface MiddlewareBundleDeps {
  readonly auditLogger: AuditLogger;
  readonly appPool: SecureCorePool;
  readonly allowedOrigins: readonly string[];
  /** Defaults to a fresh `InMemoryRateLimitStore`. */
  readonly rateLimitStore?: RateLimitStore;
}

export interface GatewayMiddlewareBundles {
  readonly login: LoginRoutesMiddleware;
  readonly session: SessionRoutesMiddleware;
  readonly bootstrap: BootstrapRoutesMiddleware;
  readonly rateLimitStore: RateLimitStore;
}

/**
 * Build the three minimum bundles the auth-vertical needs. Phase D
 * additions (workspaces / capsules / runs / tools / operator) extend
 * this object; the existing fields stay stable.
 */
export function buildGatewayMiddleware(
  deps: MiddlewareBundleDeps,
): GatewayMiddlewareBundles {
  const { auditLogger, appPool, allowedOrigins } = deps;
  const rateLimitStore = deps.rateLimitStore ?? new InMemoryRateLimitStore();

  // Per-route limiters. The endpoint tag lands in the audit row so
  // operators can tell which limit fired without parsing the request
  // path.
  const enforceLoginRateLimit: NamedMiddleware = enforceRateLimit({
    limit: 30,
    windowMs: 60_000,
    store: rateLimitStore,
    auditLogger,
    endpoint: "auth.login",
  });
  const enforceBootstrapRateLimit: NamedMiddleware = enforceRateLimit({
    // v4 §22.1: bootstrap is the tightest limit in the system. 5 hits
    // per minute per IP; a 6th in-window hit triggers the 1-hour lock.
    limit: 5,
    windowMs: 60_000,
    store: rateLimitStore,
    auditLogger,
    endpoint: "auth.bootstrap",
  });

  const enforceCsrf = enforceCsrfForStateChange({
    auditLogger,
    allowedOrigins,
  });

  const validateInputSchemaLogin = validateInputSchema(LOGIN_SCHEMA, {
    auditLogger,
  });
  const validateInputSchemaLogout = validateInputSchema(LOGOUT_SCHEMA, {
    auditLogger,
  });

  const requireAuthMw = requireAuth({
    pool: appPool,
    auditLogger,
  });

  return {
    login: {
      enforceLoginRateLimit,
      enforceCsrfForStateChange: enforceCsrf,
      validateInputSchemaLogin,
      validateInputSchemaLogout,
      requireAuth: requireAuthMw,
      attachAuditActor,
    },
    session: {
      requireAuth: requireAuthMw,
      attachAuditActor,
    },
    bootstrap: {
      enforceRateLimit: enforceBootstrapRateLimit,
      enforceCsrfForStateChange: enforceCsrf,
    },
    rateLimitStore,
  };
}

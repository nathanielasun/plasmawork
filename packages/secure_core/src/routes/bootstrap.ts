/**
 * Bootstrap route — Phase 0.5 Layer 4 task L4.9.
 *
 * v4 §22.1 endpoint:
 *
 *   POST /bootstrap
 *
 * Registration policy (gate #5 in §22.1):
 *   - The route is registered ONLY when:
 *       a. `BOOTSTRAP_ALLOWED === "1"` (deployment-time flag), AND
 *       b. The WORM marker provider returns `false` at startup.
 *   - When either gate is closed at registration time, the plugin is
 *     a no-op: a request to /bootstrap returns 404 because Fastify
 *     never matched a handler.
 *
 * Defense in depth: even when the route IS registered, the handler
 * re-checks the gates at request time. Process-startup truth can
 * drift (a marker can land between two simultaneous bootstraps; the
 * service does the same re-check transactionally inside
 * `attemptBootstrap`).
 *
 * Middleware chain (v4 §6.2 subset for unauthenticated state-change):
 *   requireRequestId  → enforceRateLimit (per-IP, very tight)
 *                     → enforceCsrfForStateChange (Origin only — no
 *                                                  cookie/header pair
 *                                                  because the caller
 *                                                  is unauthenticated)
 *                     → handler
 *   NO requireAuth — this IS the auth bootstrap.
 *
 * Lockout: §8 + §22.1 require a tight rate limit on bootstrap. The
 * configured limit is 5 attempts / minute / IP; on the 5th failed
 * attempt within the window the plugin marks the IP locked-until 1
 * hour. Subsequent requests then return 429 (the limiter's lockout
 * branch) until the lockout elapses. The lockout is NOT a comment;
 * it is set inside the handler by calling `store.lockUntil` after the
 * 5th in-window failure.
 *
 * Hard rules:
 *   - Ajv `additionalProperties: false` — body refuses extra fields.
 *   - Password ≥ 12 characters (Ajv pre-handler check).
 *   - Every failure path returns the SAME generic 4xx body — caller
 *     cannot tell which gate fired.
 *   - The route NEVER reads `actor`, `actor_user_id`, `created_by`,
 *     or `requested_by` from `req.body`.
 *   - Audit row emits on EVERY attempt (success, denial, or failure),
 *     handled by `BootstrapService.attemptBootstrap`.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import {
  BootstrapGateClosedError,
  BootstrapCredentialMismatchError,
  type BootstrapService,
} from "../bootstrap/service.js";
import type { BootstrapWormMarkerProvider } from "../bootstrap/wormMarker.js";
import type { RateLimitStore } from "../middleware/enforceRateLimit.js";
import type { AuditLogger } from "../audit/logger.js";
import { bodyValidation } from "./validation.js";

/**
 * Lockout duration after `BOOTSTRAP_FAILURE_LOCKOUT_THRESHOLD` failed
 * attempts in a single window. v4 §8 + §22.1 — exactly 1 hour.
 */
const BOOTSTRAP_LOCKOUT_MS = 60 * 60 * 1000;

/**
 * Threshold of consecutive in-window failures that triggers the
 * 1-hour IP lockout. Matches the rate-limit window's hit limit so the
 * limiter and the lockout move in lockstep.
 */
const BOOTSTRAP_FAILURE_LOCKOUT_THRESHOLD = 5;

interface BootstrapBody {
  admin_username: string;
  admin_password: string;
  oob_credential: string;
}

/**
 * Schema mirrors v4 §10.2 conventions: required fields enumerated,
 * `additionalProperties: false`, defensive maximum lengths, and the
 * password minimum length pinned at the layer the spec asks for (12).
 *
 * Phase 0.5 auth gateway (2026-05-09): the seeded root admin has no
 * email of record (email-based recovery is intentionally unavailable
 * for the platform-admin account). The body field is `admin_username`,
 * matching the alphanumeric pattern used by `/auth/login`.
 */
const BOOTSTRAP_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["admin_username", "admin_password", "oob_credential"],
  properties: {
    admin_username: {
      type: "string",
      minLength: 3,
      maxLength: 64,
      pattern: "^[A-Za-z0-9_-]{3,64}$",
    },
    admin_password: { type: "string", minLength: 12, maxLength: 1024 },
    oob_credential: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;

export interface BootstrapRoutesMiddleware {
  /** Per-IP rate limiter, configured for 5 attempts / minute. */
  readonly enforceRateLimit: NamedMiddleware;
  /** Origin-only CSRF check (the unauthenticated branch of L2.2). */
  readonly enforceCsrfForStateChange: NamedMiddleware;
}

export interface BootstrapRoutesOptions {
  readonly service: BootstrapService;
  readonly mw: BootstrapRoutesMiddleware;
  readonly auditLogger: AuditLogger;
  /**
   * Reads the `BOOTSTRAP_ALLOWED` env via `secrets/env.ts`. The plugin
   * compares for `=== "1"`; any other value (including unset) closes
   * the gate.
   */
  readonly bootstrapAllowed: string | undefined;
  /**
   * The same `BootstrapWormMarkerProvider` the service uses. The
   * plugin queries it ONCE at registration to decide whether to
   * register the route at all (gate #5). The handler re-queries via
   * `service.attemptBootstrap` at request time.
   */
  readonly wormMarker: BootstrapWormMarkerProvider;
  /**
   * The same rate-limit store the per-IP middleware reads. The
   * handler calls `store.lockUntil(ip, now + 1h)` on the
   * BOOTSTRAP_FAILURE_LOCKOUT_THRESHOLD-th failure so the next
   * attempt returns 429 instead of 403.
   */
  readonly rateLimitStore: RateLimitStore;
  /** Same key extractor the rate-limit middleware uses. */
  readonly rateLimitKeyExtractor: (
    req: import("fastify").FastifyRequest,
  ) => string;
  /** Optional clock seam for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export const bootstrapRoutes: FastifyPluginAsync<BootstrapRoutesOptions> =
  async (app: FastifyInstance, opts) => {
    // -----------------------------------------------------------------
    // Gate #2 + #4 at registration time.
    // -----------------------------------------------------------------
    if (opts.bootstrapAllowed !== "1") {
      // Gate #2 closed — endpoint is not registered. Fastify returns
      // 404 for any /bootstrap request because no handler exists.
      return;
    }
    let alreadyBootstrapped: boolean;
    try {
      alreadyBootstrapped = await opts.wormMarker.isBootstrapped();
    } catch {
      // Probe error at startup: fail closed. Gate is treated as
      // closed; route does not register.
      return;
    }
    if (alreadyBootstrapped) {
      return;
    }

    // -----------------------------------------------------------------
    // POST /bootstrap
    // -----------------------------------------------------------------
    const now = opts.now ?? Date.now;
    const validateBootstrapBody = bodyValidation(
      BOOTSTRAP_BODY_SCHEMA,
      opts.auditLogger,
    );

    app.post<{ Body: BootstrapBody }>(
      "/bootstrap",
      {
        preHandler: composeMiddleware([
          opts.mw.enforceRateLimit,
          opts.mw.enforceCsrfForStateChange,
          validateBootstrapBody,
        ]),
      },
      async (req, reply) => {
        const ip = opts.rateLimitKeyExtractor(req);
        try {
          const result = await opts.service.attemptBootstrap({
            adminUsername: req.body.admin_username,
            adminPassword: req.body.admin_password,
            oobCredential: req.body.oob_credential,
            requestId: req.requestId,
          });
          return reply.code(201).send({ admin_user_id: result.adminUserId });
        } catch (err) {
          if (
            err instanceof BootstrapGateClosedError ||
            err instanceof BootstrapCredentialMismatchError
          ) {
            // Inspect the in-window failure count. The limiter's hit
            // already happened in the preHandler, so peek (no
            // additional consumption) is the right read.
            const peeked = await opts.rateLimitStore.peek(
              ip,
              now(),
              60_000,
            );
            if (peeked.count >= BOOTSTRAP_FAILURE_LOCKOUT_THRESHOLD) {
              await opts.rateLimitStore.lockUntil(
                ip,
                now() + BOOTSTRAP_LOCKOUT_MS,
              );
            }
          }
          throw err;
        }
      },
    );
  };

/**
 * Login + logout routes — Phase 0.5 audit fix F1 + F2 (2026-05-09).
 *
 * v4 §5 (identity) + §7 (browser sessions) endpoints:
 *
 *   POST /auth/login    (unauthenticated)
 *   POST /auth/logout   (authenticated)
 *
 * Closes the deployment-blocker audited 2026-05-08: no code in
 * `secure_core/src/` previously created `sessions` rows or set the
 * `secure_session` / `csrf_token` cookies. Recovery flows shipped
 * earlier are post-login token consumers — they never minted a
 * session, so password-reset was a UX dead-end.
 *
 * Cookie contract upheld here:
 *   - `secure_session` — HttpOnly, Secure, SameSite=Lax. The raw
 *     session token is set as the cookie value; the SHA-256 hash is
 *     persisted in `sessions.session_hash`. The token NEVER appears
 *     in the response body or any audit metadata.
 *   - `csrf_token` — Secure, SameSite=Lax, NOT HttpOnly so the SPA
 *     can read it and echo it as `X-CSRF-Token`. The raw value is
 *     ALSO returned in the response body (§7.2 double-submit
 *     pattern: the SPA caches it in memory; the cookie is the
 *     redundant defense).
 *
 * Anti-enumeration (§8): every login failure returns the same
 * generic 401 body ("Invalid username or password.") regardless of
 * whether the username exists, the password matched, or the user was
 * disabled. The audit chain captures the discriminated reason; the
 * HTTP response does not.
 *
 * Hard rules upheld:
 *   - Routes never read `actor` / `actor_user_id` / `user_id` /
 *     `created_by` from `req.body`. Body fields are exactly
 *     `{ username, password }` for login and `{}` for logout.
 *   - Body schema is `additionalProperties: false`.
 *   - Per-IP rate limit composes at the route layer (mirrors
 *     `routes/auth.ts` recovery flows). The per-account lockout
   *     lives in `LoginService.authenticatePassword` itself: it reads
   *     `user_credentials.locked_until` but still runs the password
   *     verifier before deciding the generic 401, preserving timing
   *     parity across missing / disabled / locked / wrong-password
   *     accounts. A write through `recordVerificationOutcome`
   *     increments `failed_attempts` after every wrong password (with
   *     the lockout actually fired by the gateway's argon2 adapter
   *     when the threshold is crossed). Doc fix 2026-05-10 — the prior
   *     "per-username at the route layer" copy was inaccurate: the
   *     lockout is service-layer, not middleware-layer.
 *   - Logout ALWAYS clears both cookies regardless of whether the
 *     session-revocation succeeded (idempotent client cleanup).
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import type { LoginService } from "../auth/loginService.js";
import {
  SecureCoreError,
  UnauthenticatedError,
} from "../errors/shapes.js";

export const SESSION_COOKIE_NAME = "secure_session";
export const CSRF_COOKIE_NAME = "csrf_token";

interface LoginBody {
  username: string;
  password: string;
}

/**
 * Username pattern: alphanumeric + underscore + hyphen, 3-64 chars.
 * Phase 0.5 auth gateway (2026-05-09) made username the primary login
 * identifier. The pattern is intentionally narrow so administrators
 * cannot accidentally pick a username that contains shell-meta or
 * URL-meta characters.
 */
const USERNAME_REGEX = "^[A-Za-z0-9_-]{3,64}$";

export const LOGIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["username", "password"],
  properties: {
    username: { type: "string", minLength: 3, maxLength: 64, pattern: USERNAME_REGEX },
    password: { type: "string", minLength: 1, maxLength: 512 },
  },
} as const;

export const LOGOUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

/**
 * Middleware bundle. Host composes per-route rate limits and the
 * pre-bound L2.3 validators. Login is pre-auth so `requireAuth` is
 * absent on the login chain; logout includes it.
 */
export interface LoginRoutesMiddleware {
  readonly enforceLoginRateLimit: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly validateInputSchemaLogin: NamedMiddleware;
  readonly validateInputSchemaLogout: NamedMiddleware;
  readonly requireAuth: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
}

export interface LoginRoutesOptions {
  readonly service: LoginService;
  readonly mw: LoginRoutesMiddleware;
  /**
   * Cookie shape overrides. Production deployments override
   * `domain` (so the SPA + secure_core share a parent host) and
   * may shorten `path`. Tests override `secure: false` so the
   * cookie writer doesn't refuse on plain HTTP injection.
   */
  readonly cookieDomain?: string;
  readonly cookiePath?: string;
  readonly cookieSecure?: boolean;
}

export interface LoginResponseBody {
  readonly user_id: string;
  readonly session_id: string;
  readonly assurance_level: "aal1" | "aal2" | "aal3";
  /**
   * The raw CSRF token. The SPA caches this in memory and echoes it
   * as `X-CSRF-Token` on every state-changing request. The same
   * value is also set as the `csrf_token` cookie (double-submit).
   */
  readonly csrf_token: string;
  readonly expires_at: string;
}

const LOGIN_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "user_id",
    "session_id",
    "assurance_level",
    "csrf_token",
    "expires_at",
  ],
  properties: {
    user_id: { type: "string" },
    session_id: { type: "string" },
    assurance_level: { type: "string", enum: ["aal1", "aal2", "aal3"] },
    csrf_token: { type: "string" },
    expires_at: { type: "string" },
  },
} as const;

export { LOGIN_RESPONSE_SCHEMA };

export const loginRoutes: FastifyPluginAsync<LoginRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service, mw } = opts;
  const cookiePath = opts.cookiePath ?? "/";
  const cookieSecure = opts.cookieSecure ?? true;

  // -------------------------------------------------------------------
  // POST /auth/login  — unauthenticated; mints session + CSRF cookies
  // -------------------------------------------------------------------
  app.post<{ Body: LoginBody }>(
    "/auth/login",
    {
      preHandler: composeMiddleware([
        mw.enforceLoginRateLimit,
        mw.enforceCsrfForStateChange,
        mw.validateInputSchemaLogin,
      ]),
    },
    async (req, reply) => {
      // service.authenticatePassword runs in constant-ish time and
      // throws UnauthenticatedError on any failure (audit chain
      // captures the discriminated reason).
      const outcome = await service.authenticatePassword({
        username: req.body.username,
        password: req.body.password,
        requestId: req.requestId,
      });

      // Set HttpOnly session cookie.
      reply.setCookie(SESSION_COOKIE_NAME, outcome.rawSessionToken, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: "lax",
        path: cookiePath,
        domain: opts.cookieDomain,
        expires: outcome.expiresAt,
      });
      // Set non-HttpOnly CSRF cookie. The SPA reads it via
      // document.cookie and echoes it as X-CSRF-Token on every
      // state-changing request. v4 §7.2 double-submit pattern.
      reply.setCookie(CSRF_COOKIE_NAME, outcome.rawCsrfToken, {
        httpOnly: false,
        secure: cookieSecure,
        sameSite: "lax",
        path: cookiePath,
        domain: opts.cookieDomain,
        expires: outcome.expiresAt,
      });

      const body: LoginResponseBody = {
        user_id: outcome.userId,
        session_id: outcome.sessionId,
        assurance_level: outcome.assuranceLevel,
        csrf_token: outcome.rawCsrfToken,
        expires_at: outcome.expiresAt.toISOString(),
      };
      return reply.code(200).send(body);
    },
  );

  // -------------------------------------------------------------------
  // POST /auth/logout  — authenticated; revokes session + clears cookies
  // -------------------------------------------------------------------
  app.post<{ Body: Record<string, never> }>(
    "/auth/logout",
    {
      preHandler: composeMiddleware([
        mw.requireAuth,
        mw.enforceCsrfForStateChange,
        mw.validateInputSchemaLogout,
        mw.attachAuditActor,
      ]),
    },
    async (req, reply) => {
      if (req.auth === undefined) {
        throw new UnauthenticatedError("Auth required.");
      }
      try {
        await service.terminateSession({
          sessionId: req.auth.sessionId,
          actorUserId: req.auth.userId,
          requestId: req.requestId,
        });
      } catch (err) {
        // Logout always succeeds from the client's perspective —
        // we still clear the cookies so a subsequent request fails
        // requireAuth on the missing cookie. But re-throw for any
        // SecureCoreError so the response shape is uniform; the
        // mapper converts it to the §3 envelope.
        if (err instanceof SecureCoreError) throw err;
        // Unknown error — proceed with cookie clearing below.
      }
      reply.clearCookie(SESSION_COOKIE_NAME, {
        path: cookiePath,
        domain: opts.cookieDomain,
      });
      reply.clearCookie(CSRF_COOKIE_NAME, {
        path: cookiePath,
        domain: opts.cookieDomain,
      });
      return reply.code(204).send();
    },
  );
};

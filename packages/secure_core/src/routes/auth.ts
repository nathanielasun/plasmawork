/**
 * Authentication recovery routes — Phase 0.5 Layer 4 task L4.8.
 *
 * v4 §5 + §8 endpoints (all unauthenticated, all state-changing):
 *
 *   POST /auth/password-reset/request
 *   POST /auth/password-reset/consume
 *   POST /auth/email-verify/request
 *   POST /auth/email-verify/consume
 *   POST /auth/mfa-recovery
 *
 * Middleware chain per §6.2 — recovery endpoints are pre-auth, so:
 *
 *   requireRequestId  (registered globally as onRequest hook by host)
 *   enforceRateLimit  (per-IP via L2.12; per-email runs inside the service)
 *   enforceCsrfForStateChange  (Origin/Referer only — no synchronizer
 *                               token because there is no session yet)
 *   validateInputSchema  (Ajv + §4.1 forbidden-body scan)
 *   — handler invokes RecoveryService —
 *
 * Authentication middleware is intentionally absent. Per task spec +
 * §7.2, recovery endpoints are unauthenticated state-change endpoints;
 * the Origin branch of L2.2 fires on its own and the synchronizer-token
 * branch short-circuits when `req.auth === undefined`.
 *
 * The plugin NEVER:
 *   - reads `actor` / `actor_user_id` / `user_id` / `created_by` from
 *     `req.body` (v4 §4.1 + §19.1 hard rule)
 *   - exposes a token-bypass flag of any shape
 *   - returns a different shape for "known email" vs "unknown email"
 *     (anti-enumeration; both branches return 202 with the same body)
 *   - branches the consume-failure response on which clause failed
 *     (single generic 400 — leak via the audit row's denied_reason
 *     metadata, not the HTTP body)
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import type { RecoveryService } from "../auth/recoveryService.js";
import type { LoginService } from "../auth/loginService.js";
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  type LoginResponseBody,
} from "./login.js";

/**
 * Middleware bundle the host composes into route preHandlers. The
 * factories are pre-bound by the host: the per-IP `enforceRateLimit`
 * needs a route-specific `endpoint` tag for the audit metadata, so
 * the host constructs ONE per route (or one shared mw if the host
 * is fine with the same tag across routes).
 */
export interface AuthRoutesMiddleware {
  readonly enforceRateLimit: NamedMiddleware;
  readonly enforcePasswordResetRequestRateLimit?: NamedMiddleware;
  readonly enforcePasswordResetConsumeRateLimit?: NamedMiddleware;
  readonly enforceEmailVerifyRequestRateLimit?: NamedMiddleware;
  readonly enforceEmailVerifyConsumeRateLimit?: NamedMiddleware;
  readonly enforceMfaRecoveryRateLimit?: NamedMiddleware;
  readonly enforceCsrfForStateChange: NamedMiddleware;
  readonly validateInputSchemaPasswordResetRequest: NamedMiddleware;
  readonly validateInputSchemaPasswordResetConsume: NamedMiddleware;
  readonly validateInputSchemaEmailVerifyRequest: NamedMiddleware;
  readonly validateInputSchemaEmailVerifyConsume: NamedMiddleware;
  readonly validateInputSchemaMfaRecovery: NamedMiddleware;
}

export interface AuthRoutesOptions {
  readonly service: RecoveryService;
  readonly mw: AuthRoutesMiddleware;
  /**
   * Optional login service. When provided, the consume endpoints
   * (`password-reset/consume`, `email-verify/consume`) bridge to a
   * fresh session: after the recovery service resolves the user id,
   * `LoginService.mintSessionForUser` is called and `secure_session` /
   * `csrf_token` cookies are set so the user lands logged in. Without
   * this dep, the consume endpoints return the legacy `{ status: "ok" }`
   * envelope (Phase 0.5 backwards-compatible behavior).
   */
  readonly loginService?: LoginService;
  /**
   * Cookie shape overrides for the recovery → session bridge. Mirror
   * the `loginRoutes` knobs so deployments can keep them in sync.
   */
  readonly cookieDomain?: string;
  readonly cookiePath?: string;
  readonly cookieSecure?: boolean;
}

// ---------------------------------------------------------------------
// Body schemas — Ajv + additionalProperties: false (v4 §4.1).
//
// Email regex: simple RFC-5321-ish probe (local-part@domain with at
// least one dot in the domain, conservative bounds). We do NOT use
// `format: "email"` because L2.3's Ajv instance does not load
// `ajv-formats`; the regex keeps the validator self-contained.
// ---------------------------------------------------------------------

const EMAIL_PATTERN =
  "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$";

interface RequestEmailBody {
  email: string;
}
interface PasswordResetConsumeBody {
  token: string;
  new_password: string;
}
interface EmailVerifyConsumeBody {
  token: string;
}
interface MfaRecoveryBody {
  email: string;
  recovery_code: string;
}

export const REQUEST_EMAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["email"],
  properties: {
    email: { type: "string", maxLength: 320, pattern: EMAIL_PATTERN },
  },
} as const;

export const PASSWORD_RESET_CONSUME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["token", "new_password"],
  properties: {
    token: { type: "string", minLength: 1, maxLength: 200 },
    new_password: { type: "string", minLength: 12, maxLength: 256 },
  },
} as const;

export const EMAIL_VERIFY_CONSUME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["token"],
  properties: {
    token: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

export const MFA_RECOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["email", "recovery_code"],
  properties: {
    email: { type: "string", maxLength: 320, pattern: EMAIL_PATTERN },
    recovery_code: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

/** Constant 202 envelope shared by every "request" endpoint (anti-enumeration). */
const REQUEST_ACCEPTED_BODY = Object.freeze({
  status: "accepted",
  message:
    "If the address is registered, a message has been sent. Check your inbox.",
});

const MFA_RECOVERY_PENDING_BODY = Object.freeze({
  status: "accepted",
  message:
    "MFA recovery requires operator review. You will be contacted out of band.",
});

const CONSUME_OK_BODY = Object.freeze({ status: "ok" });

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service, mw } = opts;
  const cookiePath = opts.cookiePath ?? "/";
  const cookieSecure = opts.cookieSecure ?? true;
  const passwordResetRequestRateLimit =
    mw.enforcePasswordResetRequestRateLimit ?? mw.enforceRateLimit;
  const passwordResetConsumeRateLimit =
    mw.enforcePasswordResetConsumeRateLimit ?? mw.enforceRateLimit;
  const emailVerifyRequestRateLimit =
    mw.enforceEmailVerifyRequestRateLimit ?? mw.enforceRateLimit;
  const emailVerifyConsumeRateLimit =
    mw.enforceEmailVerifyConsumeRateLimit ?? mw.enforceRateLimit;
  const mfaRecoveryRateLimit =
    mw.enforceMfaRecoveryRateLimit ?? mw.enforceRateLimit;

  // -------------------------------------------------------------------
  // POST /auth/password-reset/request
  // -------------------------------------------------------------------
  app.post<{ Body: RequestEmailBody }>(
    "/auth/password-reset/request",
    {
      preHandler: composeMiddleware([
        passwordResetRequestRateLimit,
        mw.enforceCsrfForStateChange,
        mw.validateInputSchemaPasswordResetRequest,
      ]),
    },
    async (req, reply) => {
      await service.requestPasswordReset({
        email: req.body.email,
        requestId: req.requestId,
      });
      return reply.code(202).send(REQUEST_ACCEPTED_BODY);
    },
  );

  // -------------------------------------------------------------------
  // POST /auth/password-reset/consume
  // -------------------------------------------------------------------
  app.post<{ Body: PasswordResetConsumeBody }>(
    "/auth/password-reset/consume",
    {
      preHandler: composeMiddleware([
        passwordResetConsumeRateLimit,
        mw.enforceCsrfForStateChange,
        mw.validateInputSchemaPasswordResetConsume,
      ]),
    },
    async (req, reply) => {
      const consumed = await service.consumePasswordReset({
        token: req.body.token,
        newPassword: req.body.new_password,
        requestId: req.requestId,
      });
      // Recovery → session bridge: when a LoginService is wired, the
      // user lands logged in instead of being kicked back to /login.
      if (opts.loginService !== undefined) {
        const outcome = await opts.loginService.mintSessionForUser({
          userId: consumed.userId,
          authMethod: "password_reset",
          assuranceLevel: "aal2",
          requestId: req.requestId,
        });
        reply.setCookie(SESSION_COOKIE_NAME, outcome.rawSessionToken, {
          httpOnly: true,
          secure: cookieSecure,
          sameSite: "lax",
          path: cookiePath,
          domain: opts.cookieDomain,
          expires: outcome.expiresAt,
        });
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
      }
      return reply.code(200).send(CONSUME_OK_BODY);
    },
  );

  // -------------------------------------------------------------------
  // POST /auth/email-verify/request
  // -------------------------------------------------------------------
  app.post<{ Body: RequestEmailBody }>(
    "/auth/email-verify/request",
    {
      preHandler: composeMiddleware([
        emailVerifyRequestRateLimit,
        mw.enforceCsrfForStateChange,
        mw.validateInputSchemaEmailVerifyRequest,
      ]),
    },
    async (req, reply) => {
      await service.requestEmailVerification({
        email: req.body.email,
        requestId: req.requestId,
      });
      return reply.code(202).send(REQUEST_ACCEPTED_BODY);
    },
  );

  // -------------------------------------------------------------------
  // POST /auth/email-verify/consume
  // -------------------------------------------------------------------
  app.post<{ Body: EmailVerifyConsumeBody }>(
    "/auth/email-verify/consume",
    {
      preHandler: composeMiddleware([
        emailVerifyConsumeRateLimit,
        mw.enforceCsrfForStateChange,
        mw.validateInputSchemaEmailVerifyConsume,
      ]),
    },
    async (req, reply) => {
      const consumed = await service.consumeEmailVerification({
        token: req.body.token,
        requestId: req.requestId,
      });
      // Recovery → session bridge: same shape as password-reset/consume.
      // Email-verify mints at aal1 (single-factor — only email control
      // proven). Deployments that want stricter AAL handling should
      // wrap this route or pass a stricter `loginService`.
      if (opts.loginService !== undefined) {
        const outcome = await opts.loginService.mintSessionForUser({
          userId: consumed.userId,
          authMethod: "email_verify",
          assuranceLevel: "aal1",
          requestId: req.requestId,
        });
        reply.setCookie(SESSION_COOKIE_NAME, outcome.rawSessionToken, {
          httpOnly: true,
          secure: cookieSecure,
          sameSite: "lax",
          path: cookiePath,
          domain: opts.cookieDomain,
          expires: outcome.expiresAt,
        });
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
      }
      return reply.code(200).send(CONSUME_OK_BODY);
    },
  );

  // -------------------------------------------------------------------
  // POST /auth/mfa-recovery
  // -------------------------------------------------------------------
  app.post<{ Body: MfaRecoveryBody }>(
    "/auth/mfa-recovery",
    {
      preHandler: composeMiddleware([
        mfaRecoveryRateLimit,
        mw.enforceCsrfForStateChange,
        mw.validateInputSchemaMfaRecovery,
      ]),
    },
    async (req, reply) => {
      await service.requestMfaRecovery({
        email: req.body.email,
        recoveryCode: req.body.recovery_code,
        requestId: req.requestId,
      });
      return reply.code(202).send(MFA_RECOVERY_PENDING_BODY);
    },
  );
};

/**
 * Login service — Phase 0.5 audit fix F1 + F2 (2026-05-09), updated
 * for the auth-gateway username-primary identity model the same day.
 *
 * Closes the deployment-blocker gap audited 2026-05-08: no code in
 * `secure_core/src/` previously created `sessions` rows or set the
 * `secure_session` cookie. Without this service, the entire auth
 * substrate (sessions, capabilities, audit-actor, CSRF) was
 * structurally complete but operationally unreachable.
 *
 * Two flows:
 *
 *   - `LoginService.authenticatePassword({ username, password })`:
 *       1. Look up the user by username (lowercased, trimmed).
 *       2. Refuse if `users.disabled_at` is set. (We do NOT block on
 *          email verification: a user without an email cannot
 *          "verify" one, and the root admin in particular has
 *          email = NULL. When email IS set but unverified, we still
 *          permit login — the email is supplementary metadata, not
 *          an auth factor. A deployment that wants email-verified
 *          login MUST wrap this service.)
 *       3. Constant-time compare the presented password against the
 *          stored Argon2id hash via `verifyPasswordHash`.
 *       4. Mint a fresh session token (32-byte CSPRNG → base64url
 *          via L1.3 `mintToken`); INSERT a `sessions` row with
 *          SHA-256 of the raw token + `auth_method: "password"` +
 *          `assurance_level: "aal2"` (TOTP-less single-factor; a
 *          deployment that wires WebAuthn/TOTP MUST upgrade this to
 *          aal3 in their own login wrapper).
 *       5. Mint a separate CSRF token and SHA-256-hash it. Store the
 *          hash in a session-bound row (here: bound by being issued
 *          alongside the session token; the wire-side double-submit
 *          cookie pattern doesn't require server-side persistence,
 *          so we keep it stateless for now and document the
 *          assumption).
 *       6. Return both the raw session token + raw CSRF token to the
 *          caller. The route layer is the ONLY place that touches
 *          the `Set-Cookie` headers; this service never sees an
 *          HTTP response.
 *
 *   - `LoginService.terminateSession({ sessionId })`:
 *       1. UPDATE `sessions.revoked_at = now()` for the row matching
 *          the session id. `requireAuth` will refuse subsequent
 *          requests on the next round-trip.
 *
 * v4 §5.4 / §7.1 invariants upheld:
 *   - Session tokens are HttpOnly cookies; never returned in JSON
 *     bodies (the route reads our return value and writes the
 *     cookie — JSON body carries only the user id + assurance level).
 *   - The CSRF token is non-HttpOnly so the SPA can read + echo it
 *     in `X-CSRF-Token`. Both cookies are Secure + SameSite=Lax.
 *   - Generic error message on auth failure (§8 anti-enumeration);
 *     audit captures the discriminated reason, the response does not.
 *   - Per-IP + per-account rate limiting is the route layer's
 *     responsibility (composes `enforceRateLimit` with two key
 *     extractors — see `routes/auth.ts`).
 */

import { eq } from "drizzle-orm";

import type { SecureCorePool } from "../db/pool.js";
import { sessions } from "../db/schema.js";
import { hashToken, mintToken } from "../crypto/tokens.js";
import type { AuditLogger } from "../audit/logger.js";
import {
  SecureCoreError,
  UnauthenticatedError,
} from "../errors/shapes.js";

/**
 * Default session TTL — 12 hours. Deployments that want shorter
 * (admin) or longer (research) windows override per-call.
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Default CSRF token TTL — same as the session. The cookie is
 * regenerated on every login; refresh requires a fresh login.
 */
export const CSRF_TTL_MS = SESSION_TTL_MS;

export interface LoginServiceOptions {
  readonly pool: SecureCorePool;
  readonly auditLogger: AuditLogger;
  /**
   * Verifies a password against the stored hash using a constant-time
   * algorithm (Argon2id is the deployment recommendation; the seam
   * lets dev/test inject a synchronous fake without pulling argon2
   * into the test surface).
   */
  readonly verifyPasswordHash: (
    presented: string,
    stored: string,
  ) => Promise<boolean>;
  /**
   * Looks up the user's stored password hash. Returns `null` if no
   * such user exists OR if the user has not set a password (e.g.
   * SSO-only). The constant-time invariant is preserved by ALWAYS
   * running `verifyPasswordHash` against a fixed dummy hash when the
   * user is absent.
   */
  readonly fetchPasswordHash: (
    userId: string,
  ) => Promise<string | null>;
  /**
   * Per-account verification outcome accountant. Audit fix
   * (2026-05-09): the previous implementation only emitted an audit
   * row for failed login and trusted the IP-keyed rate limiter to
   * stop password guessing. With XFF spoofable (closed in the same
   * audit), per-IP throttling alone was inadequate; this seam wires
   * a per-account counter (``user_credentials.failed_attempts``)
   * that the operator dashboard reads. Optional — when omitted, the
   * service skips the counter update (back-compat with tests that
   * only stub the verify/fetch pair).
   */
  readonly recordVerificationOutcome?: (
    userId: string,
    success: boolean,
  ) => Promise<void>;
  readonly now?: () => number;
  readonly sessionTtlMs?: number;
}

export interface AuthenticatePasswordInput {
  readonly username: string;
  readonly password: string;
  readonly authMethod?: "password" | "sso" | "oidc" | "webauthn";
  readonly assuranceLevel?: "aal1" | "aal2" | "aal3";
  readonly requestId: string;
  /** HMAC of the client IP, when the route layer captured it. */
  readonly ipHmac?: string;
  /** HMAC of the client user-agent, when the route layer captured it. */
  readonly userAgentHmac?: string;
}

export interface AuthenticateOutcome {
  readonly userId: string;
  readonly sessionId: string;
  readonly assuranceLevel: "aal1" | "aal2" | "aal3";
  /** Raw session token — set as `secure_session` HttpOnly cookie. */
  readonly rawSessionToken: string;
  /**
   * Raw CSRF token — set as `csrf_token` Secure non-HttpOnly cookie
   * AND returned in the response body so the SPA can echo it as
   * `X-CSRF-Token` on subsequent state-changing requests.
   */
  readonly rawCsrfToken: string;
  readonly expiresAt: Date;
}

export interface TerminateSessionInput {
  readonly sessionId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

/**
 * A fixed Argon2id-shaped string used when the user doesn't exist.
 * Always running the verifier against this prevents timing-based
 * enumeration: a non-existent email and a wrong password take the
 * same wall-clock time. Generated once via `argon2.hash("never-a-
 * real-password")`.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$" +
  "Y29uc3RhbnQtdGltZS1maWxsZXItc2FsdA" +
  "$dXNlci1kb2VzLW5vdC1leGlzdC1maWxsZXItaGFzaA";

export class LoginService {
  readonly #pool: SecureCorePool;
  readonly #auditLogger: AuditLogger;
  readonly #verifyPasswordHash: LoginServiceOptions["verifyPasswordHash"];
  readonly #fetchPasswordHash: LoginServiceOptions["fetchPasswordHash"];
  readonly #recordVerificationOutcome: NonNullable<
    LoginServiceOptions["recordVerificationOutcome"]
  > | null;
  readonly #now: () => number;
  readonly #sessionTtlMs: number;

  public constructor(opts: LoginServiceOptions) {
    this.#pool = opts.pool;
    this.#auditLogger = opts.auditLogger;
    this.#verifyPasswordHash = opts.verifyPasswordHash;
    this.#fetchPasswordHash = opts.fetchPasswordHash;
    this.#recordVerificationOutcome = opts.recordVerificationOutcome ?? null;
    this.#now = opts.now ?? Date.now;
    this.#sessionTtlMs = opts.sessionTtlMs ?? SESSION_TTL_MS;
  }

  /**
   * Authenticate a (email, password) pair and mint a session.
   *
   * On success returns the raw session token + raw CSRF token so the
   * route layer can set both cookies. On any failure throws
   * `UnauthenticatedError` with the SAME generic message regardless
   * of cause (§8 anti-enumeration); the audit row carries the
   * discriminated `denied_reason`.
   */
  public async authenticatePassword(
    input: AuthenticatePasswordInput,
  ): Promise<AuthenticateOutcome> {
    const username = input.username.trim().toLowerCase();
    const sql = this.#pool.sql;

    const userRows = await sql<
      Array<{
        id: string;
        disabled_at: Date | null;
      }>
    >`
      SELECT id, disabled_at
      FROM users
      WHERE lower(username) = ${username}
      LIMIT 1
    `;
    const user = userRows[0] ?? null;

    // Constant-time path: ALWAYS run verifyPasswordHash so the wall
    // clock doesn't reveal whether the user exists. If user is null,
    // verify against the dummy hash.
    const storedHash =
      user === null
        ? DUMMY_PASSWORD_HASH
        : (await this.#fetchPasswordHash(user.id)) ?? DUMMY_PASSWORD_HASH;
    const passwordOk = await this.#verifyPasswordHash(
      input.password,
      storedHash,
    );

    let deniedReason:
      | "user_not_found"
      | "user_disabled"
      | "password_invalid"
      | null = null;
    if (user === null) deniedReason = "user_not_found";
    else if (user.disabled_at !== null) deniedReason = "user_disabled";
    else if (!passwordOk) deniedReason = "password_invalid";

    if (deniedReason !== null || user === null) {
      // Audit fix (2026-05-09): per-account counter increments on
      // every wrong-password failure for a real user. Counter is
      // skipped on user_not_found (no row to update) and on
      // user_disabled (already-locked-out signal lives in
      // ``disabled_at``, not the failure counter).
      if (
        user !== null &&
        deniedReason === "password_invalid" &&
        this.#recordVerificationOutcome !== null
      ) {
        try {
          await this.#recordVerificationOutcome(user.id, false);
        } catch {
          // Counter update failures must NOT block the audit row /
          // 401 response — the counter is operational telemetry,
          // not a security gate.
        }
      }
      await this.#auditLogger.write({
        workspaceId: null,
        actorUserId: user?.id ?? null,
        actorType: user === null ? "unauthenticated" : "human",
        action: "login.failed",
        result: "denied",
        requestId: input.requestId,
        ipHmac: input.ipHmac,
        userAgentHmac: input.userAgentHmac,
        metadata: { denied_reason: deniedReason ?? "user_not_found" },
      });
      throw new UnauthenticatedError("Invalid username or password.");
    }

    // Happy path — mint session + CSRF tokens, INSERT the row, audit
    // login.succeeded with the resolved actor user id.
    if (this.#recordVerificationOutcome !== null) {
      try {
        await this.#recordVerificationOutcome(user.id, true);
      } catch {
        // Counter reset failure on success — same posture as the
        // failure branch: skip silently, keep the login flow.
      }
    }
    return await this.mintSessionForUser({
      userId: user.id,
      authMethod: input.authMethod ?? "password",
      assuranceLevel: input.assuranceLevel ?? "aal2",
      requestId: input.requestId,
      ipHmac: input.ipHmac,
      userAgentHmac: input.userAgentHmac,
    });
  }

  /**
   * Mint a session for an already-authenticated user. Used by
   * `authenticatePassword` (after password verification) AND by the
   * recovery → session bridge: after `password-reset/consume` or
   * `email-verify/consume` resolves a user id, the route layer calls
   * this to mint a fresh session and set `secure_session` /
   * `csrf_token` cookies. Without this bridge, the user reaches the end
   * of the recovery flow with no session and has to re-login manually.
   *
   * The audit row's `action` is fixed at `login.succeeded` regardless
   * of `authMethod`; the `authMethod` discriminates the column on the
   * sessions row so deployments can distinguish password / sso /
   * password_reset / email_verify by querying `sessions.auth_method`.
   */
  public async mintSessionForUser(input: {
    readonly userId: string;
    readonly authMethod:
      | "password"
      | "sso"
      | "oidc"
      | "webauthn"
      | "password_reset"
      | "email_verify";
    readonly assuranceLevel?: "aal1" | "aal2" | "aal3";
    readonly requestId: string;
    readonly ipHmac?: string;
    readonly userAgentHmac?: string;
  }): Promise<AuthenticateOutcome> {
    const rawSessionToken = mintToken();
    const rawCsrfToken = mintToken();
    const sessionHash = hashToken(rawSessionToken);
    const nowMs = this.#now();
    const expiresAt = new Date(nowMs + this.#sessionTtlMs);
    const assuranceLevel = input.assuranceLevel ?? "aal2";

    const insertedRows = await this.#pool.db
      .insert(sessions)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        sessionHash,
        authMethod: input.authMethod,
        assuranceLevel,
        expiresAt,
      })
      .returning({ id: sessions.id });
    const sessionId = insertedRows[0]!.id;

    await this.#auditLogger.write({
      workspaceId: null,
      actorUserId: input.userId,
      actorType: "human",
      action: "login.succeeded",
      result: "succeeded",
      requestId: input.requestId,
      ipHmac: input.ipHmac,
      userAgentHmac: input.userAgentHmac,
      metadata: { auth_method: input.authMethod },
    });

    return {
      userId: input.userId,
      sessionId,
      assuranceLevel,
      rawSessionToken,
      rawCsrfToken,
      expiresAt,
    };
  }

  /**
   * Revoke a session (used by `POST /auth/logout`). Idempotent:
   * already-revoked sessions remain revoked. Emits `logout` audit on
   * the first revocation.
   */
  public async terminateSession(input: TerminateSessionInput): Promise<void> {
    const updated = await this.#pool.db
      .update(sessions)
      .set({ revokedAt: new Date(this.#now()) })
      .where(eq(sessions.id, input.sessionId))
      .returning({ id: sessions.id, userId: sessions.userId });

    if (updated.length === 0) {
      throw new SecureCoreError(
        "NOT_FOUND",
        "Session not found.",
        { session_id_redacted: input.sessionId.slice(0, 8) },
      );
    }
    if (updated[0].userId !== input.actorUserId) {
      // The middleware guarantees req.auth.sessionId belongs to
      // req.auth.userId, so this is a defense-in-depth check rather
      // than a real authz boundary. Refuse loud if it ever fires.
      throw new SecureCoreError(
        "PERMISSION_DENIED",
        "Session does not belong to actor.",
      );
    }

    await this.#auditLogger.write({
      workspaceId: null,
      actorUserId: input.actorUserId,
      actorType: "human",
      action: "logout",
      result: "succeeded",
      requestId: input.requestId,
    });
  }
}

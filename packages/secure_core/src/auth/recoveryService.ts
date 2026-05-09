/**
 * Recovery service — Phase 0.5 Layer-4 (L4.8).
 *
 * Implements v4 §5 (identity + sessions) recovery flows:
 *
 *   - password reset request   → mint + hash + store
 *   - password reset consume   → §16.4 atomic UPDATE single-use
 *   - email verify request     → mint + hash + store
 *   - email verify consume     → §16.4 atomic UPDATE single-use
 *   - mfa recovery             → audit + 202 stub (operator review)
 *
 * Constraints from the task spec + v4 §8:
 *
 *   - Recovery endpoints are unauthenticated. Audit rows therefore
 *     carry `actorType: "unauthenticated"` and `actorUserId: null`
 *     (the §19.1 server-derived rule is preserved by NEVER reading
 *     identity from the request body).
 *   - Anti-enumeration: `requestPasswordReset` / `requestEmailVerification`
 *     do equal work whether the email maps to a user or not — a fresh
 *     token is minted + hashed even on the unknown-email branch and
 *     the result is dropped on the floor. `Date.now`-level timing
 *     differences remain (DB write vs no DB write); the §8 spec only
 *     requires "generic error messages" + same-shape responses, which
 *     are guaranteed by the routes returning a fixed shape regardless.
 *   - Per-IP rate limits live in the L2.12 middleware (composed by
 *     the route). Per-email rate limits run inside this service via
 *     the same `RateLimitStore` so that the §8 layered-limit rule is
 *     honoured without composing two `enforceRateLimit` slots (which
 *     `composeMiddleware` forbids).
 *   - Single-use semantics follow v4 §16.4: one atomic UPDATE that
 *     pins `used_at IS NULL AND revoked_at IS NULL AND expires_at >
 *     now()`. 0 rows → generic "Token invalid or expired" error.
 *     The service never SELECTs first to discriminate "expired" vs
 *     "already used" vs "not found" — it would leak which clause
 *     failed.
 *
 * DB seam: a small `RecoveryRepo` interface. Production wraps
 * `pool.sql` with the §16.4 atomic UPDATE; tests stub the interface
 * directly. The shape is small enough to reason about every gate
 * verbatim.
 */

import type { AuditLogger } from "../audit/logger.js";
import type { RateLimitStore } from "../middleware/enforceRateLimit.js";
import {
  InputInvalidError,
  RateLimitedError,
  SecureCoreError,
} from "../errors/shapes.js";
import { hashToken, mintToken } from "../crypto/tokens.js";
import type { EmailSender } from "./emailSender.js";

/**
 * Result of a §16.4 atomic single-use UPDATE. The service does not
 * branch its caller-visible response on `outcome` — it's used only
 * to choose between "200 OK + apply side effect" and "400 generic
 * Token invalid or expired".
 *
 * The repo populates `userId` on a successful consume so the route
 * (or a follow-up Layer-5 task that issues a session) can finish the
 * password rotation. We DO NOT return an email or display name; the
 * caller has the user id and can fetch what it needs through other
 * authorised paths.
 */
export interface ConsumeOutcome {
  consumed: boolean;
  userId: string | null;
}

/**
 * RecoveryRepo — narrow DB seam.
 *
 * Production implementation wraps `pool.sql` (postgres-js) with:
 *
 *   findUserIdByEmail:
 *     SELECT id FROM users WHERE email = $1 AND disabled_at IS NULL
 *
 *   insertPasswordResetToken / insertEmailVerificationToken:
 *     INSERT INTO password_reset_tokens (id, user_id, token_hash,
 *       expires_at) VALUES ($1, $2, $3, $4)
 *
 *   consumePasswordResetToken:
 *     UPDATE password_reset_tokens
 *        SET used_at = now()
 *      WHERE token_hash = $1 AND used_at IS NULL
 *        AND revoked_at IS NULL AND expires_at > now()
 *      RETURNING user_id
 *
 *   consumeEmailVerificationToken:
 *     UPDATE email_verification_tokens
 *        SET used_at = now()
 *      WHERE token_hash = $1 AND used_at IS NULL
 *        AND expires_at > now()
 *      RETURNING user_id, email
 *     (followed by UPDATE users SET email_verified_at = now()
 *      WHERE id = $userId, in the same transaction)
 *
 * applyPasswordReset is split out so the unit tests can verify
 * the route only triggers the password update on the consume path
 * AFTER the atomic UPDATE returned 1 row — never before.
 */
export interface RecoveryRepo {
  findUserIdByEmail(email: string): Promise<string | null>;
  insertPasswordResetToken(args: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  insertEmailVerificationToken(args: {
    id: string;
    userId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  consumePasswordResetToken(tokenHash: string): Promise<ConsumeOutcome>;
  consumeEmailVerificationToken(tokenHash: string): Promise<ConsumeOutcome>;
  /** Apply the new password (bcrypt/argon2 hashing happens here in production). */
  applyPasswordReset(args: {
    userId: string;
    newPassword: string;
  }): Promise<void>;
}

/** TTLs picked to match v4 §8 / §22 conventions. */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 min
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/** Per-email rate limits (§8 layered limit; per-IP runs in L2.12). */
export const PASSWORD_RESET_EMAIL_LIMIT = 5;
export const PASSWORD_RESET_EMAIL_WINDOW_MS = 60 * 60 * 1000; // 1 h
export const EMAIL_VERIFY_EMAIL_LIMIT = 5;
export const EMAIL_VERIFY_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const MFA_RECOVERY_EMAIL_LIMIT = 3;
export const MFA_RECOVERY_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Minimum password length — matches v4 §5.2 default and the route schema. */
export const MIN_PASSWORD_LENGTH = 12;

export interface RecoveryServiceOptions {
  readonly repo: RecoveryRepo;
  readonly emailSender: EmailSender;
  readonly auditLogger: AuditLogger;
  readonly rateLimitStore: RateLimitStore;
  /** Front-end origin used to build the email URLs; injected so we never read it from `req`. */
  readonly frontendOrigin: string;
  /** Clock seam for tests. Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** UUID generator seam. Defaults to `crypto.randomUUID()`. */
  readonly generateId?: () => string;
}

function defaultNow(): Date {
  return new Date();
}

function defaultGenerateId(): string {
  return crypto.randomUUID();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface RequestPasswordResetInput {
  email: string;
  requestId: string;
}

export interface ConsumePasswordResetInput {
  token: string;
  newPassword: string;
  requestId: string;
}

export interface RequestEmailVerificationInput {
  email: string;
  requestId: string;
}

export interface ConsumeEmailVerificationInput {
  token: string;
  requestId: string;
}

export interface RequestMfaRecoveryInput {
  email: string;
  recoveryCode: string;
  requestId: string;
}

/**
 * The service. Stateless; safe to instantiate once at boot.
 */
export class RecoveryService {
  readonly #repo: RecoveryRepo;
  readonly #emailSender: EmailSender;
  readonly #auditLogger: AuditLogger;
  readonly #rateLimitStore: RateLimitStore;
  readonly #frontendOrigin: string;
  readonly #now: () => Date;
  readonly #generateId: () => string;

  public constructor(opts: RecoveryServiceOptions) {
    this.#repo = opts.repo;
    this.#emailSender = opts.emailSender;
    this.#auditLogger = opts.auditLogger;
    this.#rateLimitStore = opts.rateLimitStore;
    this.#frontendOrigin = opts.frontendOrigin;
    this.#now = opts.now ?? defaultNow;
    this.#generateId = opts.generateId ?? defaultGenerateId;
  }

  /** Per-email limiter check + audit. Throws RateLimitedError on bust. */
  async #enforcePerEmailLimit(args: {
    family: "password_reset" | "email_verify" | "mfa_recovery";
    email: string;
    limit: number;
    windowMs: number;
    requestId: string;
  }): Promise<void> {
    const key = `recovery:${args.family}:${args.email}`;
    const t = this.#now().getTime();
    const bucket = await this.#rateLimitStore.hit(key, t, args.windowMs);
    if (bucket.count > args.limit) {
      await this.#auditLogger.write({
        workspaceId: null,
        actorUserId: null,
        actorType: "unauthenticated",
        action: "rate_limit.triggered",
        result: "denied",
        requestId: args.requestId,
        metadata: {
          endpoint: `auth.${args.family}`,
          denied_reason: "per_email_window_exceeded",
        },
      });
      throw new RateLimitedError("Too many requests.", undefined);
    }
  }

  // -----------------------------------------------------------------
  // Password reset request
  // -----------------------------------------------------------------
  public async requestPasswordReset(
    input: RequestPasswordResetInput,
  ): Promise<void> {
    const email = normalizeEmail(input.email);

    await this.#enforcePerEmailLimit({
      family: "password_reset",
      email,
      limit: PASSWORD_RESET_EMAIL_LIMIT,
      windowMs: PASSWORD_RESET_EMAIL_WINDOW_MS,
      requestId: input.requestId,
    });

    // Always do equal work — mint + hash even if no user matches.
    const rawToken = mintToken();
    const tokenHash = hashToken(rawToken);
    const id = this.#generateId();
    const expiresAt = new Date(this.#now().getTime() + PASSWORD_RESET_TTL_MS);

    const userId = await this.#repo.findUserIdByEmail(email);
    if (userId !== null) {
      await this.#repo.insertPasswordResetToken({
        id,
        userId,
        tokenHash,
        expiresAt,
      });
      const resetUrl = `${this.#frontendOrigin}/auth/password-reset/consume?token=${encodeURIComponent(rawToken)}`;
      await this.#emailSender.sendPasswordResetEmail({
        toEmail: email,
        token: rawToken,
        resetUrl,
        expiresAt: expiresAt.toISOString(),
      });
    }
    // Unknown-email branch: drop tokenHash + id silently. Same wall-clock
    // shape as the matched branch from the caller's perspective; the
    // route returns a fixed 202 body either way.
  }

  // -----------------------------------------------------------------
  // Password reset consume — §16.4 atomic single-use
  // -----------------------------------------------------------------
  public async consumePasswordReset(
    input: ConsumePasswordResetInput,
  ): Promise<{ userId: string }> {
    if (
      typeof input.token !== "string" ||
      input.token.length === 0 ||
      typeof input.newPassword !== "string" ||
      input.newPassword.length < MIN_PASSWORD_LENGTH
    ) {
      // Generic — never reveal which check failed.
      throw new InputInvalidError("Token invalid or expired.");
    }

    const presentedHash = hashToken(input.token);
    const outcome = await this.#repo.consumePasswordResetToken(presentedHash);

    if (!outcome.consumed || outcome.userId === null) {
      await this.#auditLogger.write({
        workspaceId: null,
        actorUserId: null,
        actorType: "unauthenticated",
        action: "login.failed",
        result: "denied",
        requestId: input.requestId,
        metadata: {
          endpoint: "auth.password_reset_consume",
          denied_reason: "invalid_or_expired",
        },
      });
      throw new SecureCoreError(
        "INPUT_INVALID",
        "Token invalid or expired.",
      );
    }

    await this.#repo.applyPasswordReset({
      userId: outcome.userId,
      newPassword: input.newPassword,
    });
    return { userId: outcome.userId };
  }

  // -----------------------------------------------------------------
  // Email verification request
  // -----------------------------------------------------------------
  public async requestEmailVerification(
    input: RequestEmailVerificationInput,
  ): Promise<void> {
    const email = normalizeEmail(input.email);

    await this.#enforcePerEmailLimit({
      family: "email_verify",
      email,
      limit: EMAIL_VERIFY_EMAIL_LIMIT,
      windowMs: EMAIL_VERIFY_EMAIL_WINDOW_MS,
      requestId: input.requestId,
    });

    const rawToken = mintToken();
    const tokenHash = hashToken(rawToken);
    const id = this.#generateId();
    const expiresAt = new Date(this.#now().getTime() + EMAIL_VERIFY_TTL_MS);

    const userId = await this.#repo.findUserIdByEmail(email);
    if (userId !== null) {
      await this.#repo.insertEmailVerificationToken({
        id,
        userId,
        email,
        tokenHash,
        expiresAt,
      });
      const verifyUrl = `${this.#frontendOrigin}/auth/email-verify/consume?token=${encodeURIComponent(rawToken)}`;
      await this.#emailSender.sendEmailVerification({
        toEmail: email,
        token: rawToken,
        verifyUrl,
        expiresAt: expiresAt.toISOString(),
      });
    }
  }

  // -----------------------------------------------------------------
  // Email verification consume — §16.4 atomic single-use
  // -----------------------------------------------------------------
  public async consumeEmailVerification(
    input: ConsumeEmailVerificationInput,
  ): Promise<{ userId: string }> {
    if (typeof input.token !== "string" || input.token.length === 0) {
      throw new InputInvalidError("Token invalid or expired.");
    }
    const presentedHash = hashToken(input.token);
    const outcome = await this.#repo.consumeEmailVerificationToken(
      presentedHash,
    );
    if (!outcome.consumed || outcome.userId === null) {
      await this.#auditLogger.write({
        workspaceId: null,
        actorUserId: null,
        actorType: "unauthenticated",
        action: "login.failed",
        result: "denied",
        requestId: input.requestId,
        metadata: {
          endpoint: "auth.email_verify_consume",
          denied_reason: "invalid_or_expired",
        },
      });
      throw new SecureCoreError(
        "INPUT_INVALID",
        "Token invalid or expired.",
      );
    }
    return { userId: outcome.userId };
  }

  // -----------------------------------------------------------------
  // MFA recovery — Phase 0.5 stub: audit + 202 "operator review".
  // -----------------------------------------------------------------
  public async requestMfaRecovery(
    input: RequestMfaRecoveryInput,
  ): Promise<void> {
    const email = normalizeEmail(input.email);

    await this.#enforcePerEmailLimit({
      family: "mfa_recovery",
      email,
      limit: MFA_RECOVERY_EMAIL_LIMIT,
      windowMs: MFA_RECOVERY_EMAIL_WINDOW_MS,
      requestId: input.requestId,
    });

    // MVP: do not unlock anything; just record the request. Layer-5 wires
    // the operator-review queue + offline review flow.
    await this.#auditLogger.write({
      workspaceId: null,
      actorUserId: null,
      actorType: "unauthenticated",
      action: "login.failed",
      result: "denied",
      requestId: input.requestId,
      metadata: {
        endpoint: "auth.mfa_recovery",
        denied_reason: "mfa_recovery_pending_review",
      },
    });
  }
}

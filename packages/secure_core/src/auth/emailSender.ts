/**
 * Email sender — Phase 0.5 Layer-4 (L4.8) recovery flows.
 *
 * Production wires this to SES / SendGrid / Postmark in Layer 5; for
 * Phase 0.5 (recovery flows only) the interface exists so the L4
 * route + service can be unit-tested without a network seam, and so
 * the wiring contract is fixed before Layer 5 builds the transport.
 *
 * The interface is intentionally tiny: each method takes only the
 * fields the email body needs (the recipient address, the raw token
 * the user must echo back, an absolute URL the front end built). The
 * service NEVER hands the sender a database row, a session, or any
 * server-derived field beyond what the email body needs.
 *
 * Tokens are passed as raw strings here (NOT hashes) because the
 * email IS the only out-of-band channel the user gets. The service
 * has already stored only `hashToken(token)` — the raw value lives
 * exactly two places: in the email link and in the user's mind.
 */

export interface PasswordResetEmailOptions {
  readonly toEmail: string;
  /** Raw token (43-char base64url). The hash is stored, this is the channel value. */
  readonly token: string;
  /** Absolute URL the front-end built; lets the email be self-contained. */
  readonly resetUrl: string;
  /** Expiry as ISO-8601; UI shows "expires at ..." text. */
  readonly expiresAt: string;
}

export interface EmailVerificationOptions {
  readonly toEmail: string;
  readonly token: string;
  readonly verifyUrl: string;
  readonly expiresAt: string;
}

export interface EmailSender {
  sendPasswordResetEmail(opts: PasswordResetEmailOptions): Promise<void>;
  sendEmailVerification(opts: EmailVerificationOptions): Promise<void>;
}

/**
 * Test-only sender. Records each call so unit tests can assert that the
 * service invoked the right method with the right shape — and crucially
 * never received a forbidden field (e.g. user_id) the service should have
 * derived server-side and consumed without echoing.
 *
 * NOT exported through `src/auth/index.ts` (intentionally — production
 * code paths must reach for the production sender, not this stub).
 */
export class StubEmailSender implements EmailSender {
  public readonly passwordResetCalls: PasswordResetEmailOptions[] = [];
  public readonly emailVerificationCalls: EmailVerificationOptions[] = [];

  public async sendPasswordResetEmail(
    opts: PasswordResetEmailOptions,
  ): Promise<void> {
    this.passwordResetCalls.push(opts);
  }

  public async sendEmailVerification(
    opts: EmailVerificationOptions,
  ): Promise<void> {
    this.emailVerificationCalls.push(opts);
  }
}

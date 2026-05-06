/**
 * Outbound webhook signer + verifier — Phase 0.5 Layer 3 (L3.10).
 *
 * v4 §26.2:
 *
 *   "Outbound webhooks must be HMAC-signed. Signature covers
 *    `timestamp || canonical_body`. Receivers reject:
 *    1. unsigned payloads,
 *    2. stale timestamp beyond 5 minutes,
 *    3. invalid signatures."
 *
 * The signer:
 *   - HMAC-SHA-256 over `<unix-seconds>\n<canonical-body>` using the
 *     L1.6-supplied webhook signing key.
 *   - Emits `X-PW-Signature` and `X-PW-Timestamp` headers.
 *
 * The verifier (counterpart for any inbound webhook channel we
 * eventually run) constant-time compares and refuses timestamps
 * outside ±5 minutes (clock-skew window).
 */

import { hmacSha256, hmacBufferEqual } from "../crypto/hmac.js";
import { canonicalize } from "../crypto/jcs.js";
import { SecureCoreError } from "../errors/shapes.js";

export const WEBHOOK_SIGNATURE_HEADER = "x-pw-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-pw-timestamp";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export interface SignWebhookOptions {
  readonly hmacKey: Buffer;
  /** Body must already be JCS-canonicalizable; the signer canonicalizes. */
  readonly body: unknown;
  readonly now?: () => number;
}

export interface SignedWebhookHeaders {
  readonly canonicalBody: string;
  readonly headers: Readonly<Record<string, string>>;
}

export function signWebhook(opts: SignWebhookOptions): SignedWebhookHeaders {
  const ts = Math.floor((opts.now ?? Date.now)() / 1000).toString();
  const canonicalBody = canonicalize(opts.body);
  const signedInput = `${ts}\n${canonicalBody}`;
  const sig = hmacSha256(opts.hmacKey, signedInput);
  return {
    canonicalBody,
    headers: Object.freeze({
      [WEBHOOK_TIMESTAMP_HEADER]: ts,
      [WEBHOOK_SIGNATURE_HEADER]: sig,
    }),
  };
}

export interface VerifyWebhookOptions {
  readonly hmacKey: Buffer;
  readonly canonicalBody: string;
  readonly presentedSignature: string | undefined | null;
  readonly presentedTimestamp: string | undefined | null;
  readonly now?: () => number;
  readonly skewMs?: number;
}

export type WebhookVerifyResult =
  | { ok: true }
  | { ok: false; reason: "signature_missing" | "timestamp_missing" | "timestamp_stale" | "signature_invalid" | "timestamp_malformed" };

/**
 * Constant-time verifier. Returns a discriminated result rather than
 * throwing so the caller can pick the audit-event mapping (typically
 * a `webhook.signature_invalid` row).
 */
export function verifyWebhook(opts: VerifyWebhookOptions): WebhookVerifyResult {
  if (
    opts.presentedSignature === null ||
    opts.presentedSignature === undefined ||
    opts.presentedSignature.length === 0
  ) {
    return { ok: false, reason: "signature_missing" };
  }
  if (
    opts.presentedTimestamp === null ||
    opts.presentedTimestamp === undefined ||
    opts.presentedTimestamp.length === 0
  ) {
    return { ok: false, reason: "timestamp_missing" };
  }
  const tsNum = Number.parseInt(opts.presentedTimestamp, 10);
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    return { ok: false, reason: "timestamp_malformed" };
  }
  const now = (opts.now ?? Date.now)();
  const skew = opts.skewMs ?? FIVE_MINUTES_MS;
  if (Math.abs(now - tsNum * 1000) > skew) {
    return { ok: false, reason: "timestamp_stale" };
  }
  const expected = hmacSha256(
    opts.hmacKey,
    `${opts.presentedTimestamp}\n${opts.canonicalBody}`,
  );
  // Hex strings — equal length means a clean buffer compare; mismatch
  // length is itself a reason to reject. `hmacBufferEqual` accepts
  // hex strings and does the constant-time compare internally.
  if (expected.length !== opts.presentedSignature.length) {
    return { ok: false, reason: "signature_invalid" };
  }
  if (!hmacBufferEqual(expected, opts.presentedSignature)) {
    return { ok: false, reason: "signature_invalid" };
  }
  return { ok: true };
}

/**
 * Convenience throw-on-fail variant for callers that want a single
 * code path. Maps each reason to a `SecureCoreError`.
 */
export function assertWebhookValid(opts: VerifyWebhookOptions): void {
  const r = verifyWebhook(opts);
  if (r.ok) return;
  throw new SecureCoreError(
    "INPUT_INVALID",
    "Webhook signature verification failed.",
    { reason: r.reason },
  );
}

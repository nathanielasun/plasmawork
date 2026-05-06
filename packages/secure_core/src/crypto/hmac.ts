/**
 * Keyed HMAC utilities — Phase 0.5 Layer-1 (L1.3).
 *
 * Source contract:
 *   - v4 §16.3  (`token_context_hash` — HMAC over canonicalized inputs)
 *   - v4 §19.2  (`ip_hmac` / `user_agent_hmac` — keyed digests for audit
 *               rows so raw IP / UA strings never persist)
 *
 * Why a separate module from `tokens.ts`:
 *   - Tokens use bare SHA-256 because the input is already 256-bit
 *     CSPRNG output; HMAC adds nothing.
 *   - Context / PII fields are short, low-entropy, and attacker-known;
 *     they need a server-side key in the digest so an attacker who
 *     reads the audit table can't dictionary-attack the inputs.
 *
 * The key parameter is a `Buffer` so callers must explicitly load it
 * from the secrets module (ADR-0011) — string literals would be a
 * tempting place to hard-code a "dev key" that leaks into prod.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA-256 hex digest of `value` keyed by `key`.
 *
 * Determinism: same `(key, value)` always produces the same digest.
 * Callers that compare digests for equality must use
 * `hmacBufferEqual` so the comparison is constant-time.
 */
export function hmacSha256(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

/**
 * Constant-time compare of two hex digests.
 *
 * Returns `false` (does NOT throw) when the inputs disagree on length.
 * Same rationale as `compareTokenConstantTime`: every failure mode is
 * indistinguishable from the caller's side.
 */
export function hmacBufferEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return timingSafeEqual(ba, bb);
}

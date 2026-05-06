/**
 * Token utilities — Phase 0.5 Layer-1 (L1.3).
 *
 * Source contract:
 *   - v4 §5.4   (Session Tokens)
 *   - v4 §16.2  (Approval Token Requirements)
 *
 * Both sections impose the same rules:
 *   - At least 128 bits of entropy from a CSPRNG. We mint 256 bits so the
 *     entropy floor is unreachable even if the encoding loses a few bits
 *     to base64url alignment.
 *   - The raw token is never persisted. Only a SHA-256 (or HMAC-SHA-256)
 *     digest is stored; the presented token is hashed and compared in
 *     constant time.
 *   - Tokens expire / can be revoked. (Lifecycle lives at L3; this module
 *     only owns mint / hash / compare.)
 *
 * Encoding choice: base64url WITHOUT padding. Tokens ride header values
 * (`Authorization: Bearer …`, `X-Approval-Token: …`) and URL fragments
 * without escaping. Padding `=` would have to be percent-encoded in some
 * URL contexts; dropping padding avoids that footgun. 32 raw bytes encode
 * to exactly 43 unpadded base64url characters.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Number of CSPRNG bytes per token. 256 bits ≫ the 128-bit floor in v4
 * §5.4 / §16.2; the 128-bit redundancy is deliberate so that an encoding
 * change or partial-leak attack can't drop us below the floor silently.
 */
export const TOKEN_BYTE_LENGTH = 32;

/**
 * Length of a SHA-256 hex digest. Stored token-hash columns are typed
 * `CHAR(64)`; this constant keeps the validator and the schema in sync.
 */
export const TOKEN_HASH_HEX_LENGTH = 64;

export type TokenErrorCode = "token.invalid_format" | "token.length_mismatch";

export class TokenError extends Error {
  public readonly code: TokenErrorCode;

  constructor(code: TokenErrorCode, message: string) {
    super(message);
    this.name = "TokenError";
    this.code = code;
  }
}

/**
 * Mint a fresh token. Returns 32 CSPRNG bytes encoded as unpadded
 * base64url (43 chars). The caller stores `hashToken(token)` and gives
 * the raw token back to the user exactly once.
 */
export function mintToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
}

/**
 * SHA-256 hex digest of `token`. Used both for storage (the value we
 * persist alongside the row) and as the comparison target inside
 * `compareTokenConstantTime`.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time compare of a presented token against a stored hash.
 *
 * Behavior contract:
 *   - Always hashes the presented token first, even when we already
 *     know the lengths disagree, so the early-return path doesn't leak
 *     "the stored hash had length X" through wall-clock timing.
 *   - Returns `false` (NEVER throws) when the stored hash has the wrong
 *     length. Callers that need to distinguish "malformed input" from
 *     "wrong token" should validate the stored hash at write time, not
 *     here. The whole point of this function is to look identical for
 *     every failure mode.
 */
export function compareTokenConstantTime(
  presented: string,
  storedHash: string,
): boolean {
  // Hash first — unconditional work — so a length-mismatch early return
  // doesn't reveal it through timing.
  const presentedHash = hashToken(presented);

  if (storedHash.length !== presentedHash.length) {
    return false;
  }

  const a = Buffer.from(presentedHash, "utf8");
  const b = Buffer.from(storedHash, "utf8");

  // Buffer.from with a non-hex string still produces a valid Buffer; we
  // compare the two hex strings as raw bytes. Equal length is guaranteed
  // by the check above, so timingSafeEqual will not throw.
  return timingSafeEqual(a, b);
}

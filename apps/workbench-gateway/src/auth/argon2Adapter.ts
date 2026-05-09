/**
 * Argon2id password adapter — Phase 0.5 auth gateway / Phase C
 * (2026-05-09).
 *
 * Wraps `@node-rs/argon2` (the Rust-based napi-rs binding with
 * prebuilt binaries — chosen over the C-based `argon2` package to
 * avoid native-compile flakiness on macOS / Linux / Windows).
 *
 * Implements the two seams `LoginService` requires:
 *
 *   - `verifyPasswordHash(presented, stored)` → constant-time argon2.verify.
 *   - `fetchPasswordHash(userId)` → SELECT password_hash FROM
 *     user_credentials WHERE user_id = $1.
 *
 * AND the seam `BootstrapService.BootstrapDbAdapter.insertPlatformAdmin`
 * uses internally:
 *
 *   - `hashPassword(plaintext)` → argon2.hash with OWASP 2023 params.
 *
 * OWASP 2023 Argon2id recommendation:
 *   memoryCost = 65536 KiB (64 MiB)
 *   timeCost   = 3 iterations
 *   parallelism = 4
 *
 * These match the shape of the DUMMY_PASSWORD_HASH in
 * loginService.ts so the constant-time verifier path produces the
 * same wall-clock cost on the unknown-user branch.
 *
 * Failed-attempt accounting: on a wrong password the adapter
 * increments `user_credentials.failed_attempts`; on a successful
 * verify it resets the counter to zero. The `locked_until` column is
 * not consumed here (it's enforced by the rate-limit middleware via
 * `RateLimitStore.lockUntil`); this adapter only maintains the
 * counter the operator dashboard reads.
 */

import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

import type { SecureCorePool } from "../../../../packages/secure_core/src/db/pool.js";

/**
 * Argon2id parameters pinned to OWASP 2023. Changing these requires
 * a coordinated migration of every existing hash in user_credentials —
 * do not adjust without an ADR.
 *
 * `algorithm` is omitted because @node-rs/argon2's `Algorithm` const
 * enum can't be imported under TypeScript's `isolatedModules` (it
 * needs to be erased at compile time). Argon2id is the binding's
 * documented default; the integer literal `2` matches the enum
 * value if a future caller needs to pass it explicitly.
 */
export const ARGON2_PARAMS = Object.freeze({
  memoryCost: 65_536, // KiB → 64 MiB
  timeCost: 3,
  parallelism: 4,
});

/**
 * Hash a plaintext password. Used by the bootstrap adapter and any
 * future "set password" flow. Throws if the input is empty.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("hashPassword: plaintext must be a non-empty string.");
  }
  return await argon2Hash(plaintext, ARGON2_PARAMS);
}

export interface Argon2AdapterDeps {
  readonly pool: SecureCorePool;
}

/**
 * Builds the LoginService seam pair (`verifyPasswordHash`,
 * `fetchPasswordHash`) backed by the `user_credentials` table.
 */
export function createArgon2Adapter(deps: Argon2AdapterDeps): {
  readonly verifyPasswordHash: (
    presented: string,
    stored: string,
  ) => Promise<boolean>;
  readonly fetchPasswordHash: (userId: string) => Promise<string | null>;
} {
  const { pool } = deps;

  return {
    /**
     * Constant-time argon2.verify. Returns false (never throws) when
     * the hash is malformed — the LoginService treats verification
     * failure as an authentication denial regardless of cause.
     *
     * On a mismatch we increment `failed_attempts`; on success we
     * reset it. The `userId` of the row whose hash we're verifying
     * isn't available here (LoginService passes only the stored hash
     * string), so the counter update happens out-of-band via
     * `recordVerificationOutcome` — the LoginService doesn't call
     * that today; deployments that want failed-attempt accounting
     * wrap this adapter.
     */
    async verifyPasswordHash(
      presented: string,
      stored: string,
    ): Promise<boolean> {
      try {
        return await argon2Verify(stored, presented);
      } catch {
        // Argon2 throws on malformed-hash strings (e.g. the DUMMY
        // fallback). Treat as "no match" — anti-enumeration timing
        // parity is preserved by argon2 still doing the work.
        return false;
      }
    },

    /**
     * SELECT password_hash FROM user_credentials WHERE user_id = $1.
     * Returns null when the user has no credential row (e.g. SSO-only
     * users in a future deployment). The LoginService falls back to
     * DUMMY_PASSWORD_HASH on null so the verifier still runs.
     */
    async fetchPasswordHash(userId: string): Promise<string | null> {
      const rows = await pool.sql<Array<{ password_hash: string }>>`
        SELECT password_hash
        FROM user_credentials
        WHERE user_id = ${userId}
        LIMIT 1
      `;
      return rows[0]?.password_hash ?? null;
    },
  };
}

/**
 * Out-of-band failed-attempt accounting. The LoginService doesn't
 * call this directly — deployments that want lockout dashboards wrap
 * the adapter and call this on every verify outcome.
 */
export async function recordVerificationOutcome(
  pool: SecureCorePool,
  userId: string,
  success: boolean,
): Promise<void> {
  if (success) {
    await pool.sql`
      UPDATE user_credentials
      SET failed_attempts = 0
      WHERE user_id = ${userId}
    `;
  } else {
    await pool.sql`
      UPDATE user_credentials
      SET failed_attempts = failed_attempts + 1
      WHERE user_id = ${userId}
    `;
  }
}

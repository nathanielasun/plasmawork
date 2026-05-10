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
     * The per-account counter update happens elsewhere — the
     * LoginService NOW calls ``recordVerificationOutcome`` directly
     * (post-2026-05-10 audit fix), threading the resolved userId
     * through the seam. The function below ONLY runs the
     * cryptographic verify; the counter + lockout policy live in
     * ``recordVerificationOutcome`` further down.
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
 * Failed-attempt threshold + lockout duration. Audit fix
 * (2026-05-10): the previous implementation incremented
 * ``failed_attempts`` but nothing READ it; the documented per-account
 * lockout was a dead column. These constants pin the lockout policy
 * v4 §8 calls for: ten consecutive failures locks the account for
 * fifteen minutes. The numbers are deliberately conservative so a
 * legitimate user fat-fingering their password ten times still
 * recovers within the typical "I'll come back after a coffee" window.
 *
 * Production deployments that need a different policy should wrap the
 * adapter rather than mutating these constants — both numbers are
 * load-bearing for the operator dashboard's "locked accounts" view.
 */
export const LOGIN_LOCKOUT_THRESHOLD = 10;
export const LOGIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Per-account verification outcome. The LoginService calls this on
 * every authentication attempt; success resets the counter + clears
 * any active lockout, failure increments the counter and conditionally
 * sets ``locked_until``.
 *
 * The increment + lockout decision is done in ONE UPDATE so two
 * concurrent failed attempts can't race past the threshold without
 * being locked. The ``CASE`` expression evaluates the post-increment
 * count in-statement.
 */
export async function recordVerificationOutcome(
  pool: SecureCorePool,
  userId: string,
  success: boolean,
): Promise<void> {
  if (success) {
    await pool.sql`
      UPDATE user_credentials
      SET failed_attempts = 0,
          locked_until = NULL
      WHERE user_id = ${userId}
    `;
  } else {
    const lockoutMs = LOGIN_LOCKOUT_DURATION_MS;
    const threshold = LOGIN_LOCKOUT_THRESHOLD;
    await pool.sql`
      UPDATE user_credentials
      SET failed_attempts = failed_attempts + 1,
          locked_until = CASE
            WHEN failed_attempts + 1 >= ${threshold}
              THEN NOW() + (${lockoutMs} || ' milliseconds')::interval
            ELSE locked_until
          END
      WHERE user_id = ${userId}
    `;
  }
}

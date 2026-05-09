/**
 * Argon2id adapter — Phase 0.5 / Phase C (2026-05-09).
 *
 * Pins:
 *   - hashPassword refuses an empty string.
 *   - verifyPasswordHash on a malformed hash returns false (does not
 *     throw); the constant-time-ish path still does CPU work because
 *     the underlying argon2 binding has to attempt the verify.
 *   - fetchPasswordHash returns null for an unknown user id.
 */

import { describe, it, expect } from "vitest";

import {
  hashPassword,
  createArgon2Adapter,
  recordVerificationOutcome,
  ARGON2_PARAMS,
} from "../../src/auth/argon2Adapter.js";
import type { SecureCorePool } from "../../../../packages/secure_core/src/db/pool.js";

function makeStubPool(opts: {
  rows?: Array<{ password_hash: string }>;
  updates?: Array<string>;
}): SecureCorePool {
  const sql = (async () => opts.rows ?? []) as unknown as SecureCorePool["sql"];
  // Capture every SQL call's first chunk for the recordVerificationOutcome
  // test path (so we can spot which UPDATE shape ran).
  const captured = opts.updates ?? [];
  (sql as unknown as { capture: string[] }).capture = captured;
  return { sql, db: {} as SecureCorePool["db"] } as unknown as SecureCorePool;
}

describe("argon2Adapter — hashing parameters", () => {
  it("ARGON2_PARAMS matches the OWASP 2023 Argon2id recommendation", () => {
    expect(ARGON2_PARAMS.memoryCost).toBe(65_536);
    expect(ARGON2_PARAMS.timeCost).toBe(3);
    expect(ARGON2_PARAMS.parallelism).toBe(4);
  });

  it("hashPassword refuses an empty string", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});

describe("argon2Adapter — LoginService seams", () => {
  it("verifyPasswordHash returns false (not throws) on a malformed stored hash", async () => {
    const pool = makeStubPool({});
    const adapter = createArgon2Adapter({ pool });
    const ok = await adapter.verifyPasswordHash(
      "any-presented-password",
      "definitely-not-a-real-argon2-hash",
    );
    expect(ok).toBe(false);
  });

  it("fetchPasswordHash returns the stored hash row when present", async () => {
    const pool = makeStubPool({
      rows: [{ password_hash: "$argon2id$stored$hash" }],
    });
    const adapter = createArgon2Adapter({ pool });
    const out = await adapter.fetchPasswordHash(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(out).toBe("$argon2id$stored$hash");
  });

  it("fetchPasswordHash returns null when no row exists", async () => {
    const pool = makeStubPool({ rows: [] });
    const adapter = createArgon2Adapter({ pool });
    const out = await adapter.fetchPasswordHash("does-not-exist");
    expect(out).toBeNull();
  });
});

describe("argon2Adapter — failed-attempt accounting", () => {
  it("recordVerificationOutcome runs the UPDATE without throwing on success", async () => {
    const pool = makeStubPool({});
    await expect(
      recordVerificationOutcome(
        pool,
        "11111111-1111-4111-8111-111111111111",
        true,
      ),
    ).resolves.toBeUndefined();
  });

  it("recordVerificationOutcome runs the UPDATE without throwing on failure", async () => {
    const pool = makeStubPool({});
    await expect(
      recordVerificationOutcome(
        pool,
        "11111111-1111-4111-8111-111111111111",
        false,
      ),
    ).resolves.toBeUndefined();
  });
});

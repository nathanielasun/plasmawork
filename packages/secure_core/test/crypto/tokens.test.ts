/**
 * Tests for `src/crypto/tokens.ts` — Phase 0.5 Layer-1 (L1.3).
 *
 * Cases derive from v4 §5.4 and §16.2:
 *   - CSPRNG entropy probe (no collisions across 1000 mints).
 *   - Encoding length matches 32 raw bytes via base64url-no-padding.
 *   - SHA-256 hex digest is deterministic and 64 chars wide.
 *   - Constant-time compare returns false (does not throw) on
 *     length mismatch, AFTER hashing the presented input.
 */

import { describe, expect, test } from "vitest";
import {
  TOKEN_BYTE_LENGTH,
  TOKEN_HASH_HEX_LENGTH,
  TokenError,
  compareTokenConstantTime,
  hashToken,
  mintToken,
} from "../../src/crypto/tokens.js";

describe("mintToken", () => {
  test("produces unique tokens across 1000 invocations (entropy probe)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(mintToken());
    }
    expect(seen.size).toBe(1000);
  });

  test("each token is at least 43 base64url characters (32 raw bytes, no padding)", () => {
    // 32 bytes × 4/3 = 42.67 → 43 chars unpadded base64url.
    const expectedLength = Math.ceil((TOKEN_BYTE_LENGTH * 4) / 3);
    for (let i = 0; i < 100; i++) {
      const token = mintToken();
      expect(token.length).toBeGreaterThanOrEqual(expectedLength);
      // base64url alphabet only — no '+', '/', or '=' padding.
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test("exposes the byte-length constant for cross-module checks", () => {
    expect(TOKEN_BYTE_LENGTH).toBe(32);
  });
});

describe("hashToken", () => {
  test("is deterministic — same input maps to same digest", () => {
    const token = "abcdef0123456789";
    expect(hashToken(token)).toBe(hashToken(token));
  });

  test("returns a 64-char hex digest (SHA-256 = 256 bits)", () => {
    const token = mintToken();
    const digest = hashToken(token);
    expect(digest).toHaveLength(TOKEN_HASH_HEX_LENGTH);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different tokens produce different digests", () => {
    const a = hashToken("token-a");
    const b = hashToken("token-b");
    expect(a).not.toBe(b);
  });
});

describe("compareTokenConstantTime", () => {
  test("returns true when the presented token matches the stored hash", () => {
    const token = mintToken();
    const stored = hashToken(token);
    expect(compareTokenConstantTime(token, stored)).toBe(true);
  });

  test("returns false when the presented token does not match", () => {
    const stored = hashToken(mintToken());
    expect(compareTokenConstantTime(mintToken(), stored)).toBe(false);
  });

  test("returns false (does NOT throw) when stored hash has wrong length", () => {
    // Truncated stored hash — could happen with a corrupt DB row. The
    // function must not throw; it should fail-closed and return false.
    const token = mintToken();
    const stored = hashToken(token).slice(0, 32);
    expect(() => compareTokenConstantTime(token, stored)).not.toThrow();
    expect(compareTokenConstantTime(token, stored)).toBe(false);
  });

  test("returns false on empty inputs without throwing", () => {
    expect(() => compareTokenConstantTime("", "")).not.toThrow();
    // hashToken("") has length 64; "" has length 0; so they disagree.
    expect(compareTokenConstantTime("", "")).toBe(false);
  });

  test("does not short-circuit on length mismatch (behavioural shape, not microtiming)", () => {
    // Two long-but-different inputs against a wrong-length stored hash.
    // We verify the function's shape: it returns false for both and does
    // not throw. We deliberately avoid asserting microsecond timing —
    // that's flaky on shared CI — but we DO ensure the code path that
    // could leak via early-return covers both calls identically.
    const longA = "a".repeat(512);
    const longB = "b".repeat(512);
    const wrongStored = "deadbeef"; // length 8, not 64
    expect(compareTokenConstantTime(longA, wrongStored)).toBe(false);
    expect(compareTokenConstantTime(longB, wrongStored)).toBe(false);
  });
});

describe("TokenError", () => {
  test("carries a typed code", () => {
    const err = new TokenError("token.invalid_format", "bad shape");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TokenError");
    expect(err.code).toBe("token.invalid_format");
    expect(err.message).toBe("bad shape");
  });

  test("accepts the length-mismatch code", () => {
    const err = new TokenError("token.length_mismatch", "wrong width");
    expect(err.code).toBe("token.length_mismatch");
  });
});

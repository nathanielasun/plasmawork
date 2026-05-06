/**
 * Tests for `src/crypto/hmac.ts` — Phase 0.5 Layer-1 (L1.3).
 *
 * Cases derive from v4 §16.3 and §19.2:
 *   - Match RFC 4231 Test Case 1 byte-for-byte. If we ever swap to a
 *     different HMAC implementation this test will catch it.
 *   - Determinism + key-sensitivity.
 *   - Constant-time compare returns false (does not throw) on length
 *     mismatch.
 */

import { describe, expect, test } from "vitest";
import { hmacBufferEqual, hmacSha256 } from "../../src/crypto/hmac.js";

describe("hmacSha256", () => {
  test("matches RFC 4231 Test Case 1", () => {
    // Key = 0x0b repeated 20 times, data = "Hi There".
    // Expected = b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7
    const key = Buffer.alloc(20, 0x0b);
    const value = "Hi There";
    const expected =
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
    expect(hmacSha256(key, value)).toBe(expected);
  });

  test("matches RFC 4231 Test Case 2", () => {
    // Key = "Jefe", data = "what do ya want for nothing?"
    // Expected = 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
    const key = Buffer.from("Jefe", "utf8");
    const value = "what do ya want for nothing?";
    const expected =
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
    expect(hmacSha256(key, value)).toBe(expected);
  });

  test("is deterministic — same (key, value) yields same digest", () => {
    const key = Buffer.from("workspace-context-key", "utf8");
    const value = "approval:capsule.delete:capsule-42";
    expect(hmacSha256(key, value)).toBe(hmacSha256(key, value));
  });

  test("returns a 64-char hex digest", () => {
    const key = Buffer.from("k", "utf8");
    const digest = hmacSha256(key, "anything");
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different keys produce different digests for the same value", () => {
    const value = "203.0.113.7";
    const a = hmacSha256(Buffer.from("key-a"), value);
    const b = hmacSha256(Buffer.from("key-b"), value);
    expect(a).not.toBe(b);
  });

  test("different values produce different digests for the same key", () => {
    const key = Buffer.from("ip-hmac-key");
    const a = hmacSha256(key, "203.0.113.7");
    const b = hmacSha256(key, "203.0.113.8");
    expect(a).not.toBe(b);
  });
});

describe("hmacBufferEqual", () => {
  test("returns true on matching hex digests", () => {
    const key = Buffer.from("k");
    const a = hmacSha256(key, "v");
    const b = hmacSha256(key, "v");
    expect(hmacBufferEqual(a, b)).toBe(true);
  });

  test("returns false on mismatched digests of equal length", () => {
    const key = Buffer.from("k");
    const a = hmacSha256(key, "v1");
    const b = hmacSha256(key, "v2");
    expect(hmacBufferEqual(a, b)).toBe(false);
  });

  test("returns false (does NOT throw) on length mismatch", () => {
    const a = "deadbeef";
    const b = "deadbeefdeadbeef";
    expect(() => hmacBufferEqual(a, b)).not.toThrow();
    expect(hmacBufferEqual(a, b)).toBe(false);
  });

  test("returns false on empty-vs-nonempty without throwing", () => {
    expect(() => hmacBufferEqual("", "deadbeef")).not.toThrow();
    expect(hmacBufferEqual("", "deadbeef")).toBe(false);
  });

  test("returns true on two empty strings (degenerate but well-defined)", () => {
    // Both length 0 → timingSafeEqual on two zero-byte Buffers returns true.
    expect(hmacBufferEqual("", "")).toBe(true);
  });
});

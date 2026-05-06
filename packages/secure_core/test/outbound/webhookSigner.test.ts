/**
 * L3.10 — webhook signer + verifier tests.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";

import {
  signWebhook,
  verifyWebhook,
  assertWebhookValid,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "../../src/outbound/webhookSigner.js";
import { SecureCoreError } from "../../src/errors/shapes.js";

const KEY = randomBytes(32);

describe("signWebhook + verifyWebhook", () => {
  it("round-trips a clean payload", () => {
    const t = 1_700_000_000_000;
    const signed = signWebhook({
      hmacKey: KEY,
      body: { event: "approval.granted", id: "abc" },
      now: () => t,
    });
    expect(signed.headers[WEBHOOK_TIMESTAMP_HEADER]).toBe("1700000000");
    expect(signed.headers[WEBHOOK_SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.canonicalBody).toBe('{"event":"approval.granted","id":"abc"}');
    const r = verifyWebhook({
      hmacKey: KEY,
      canonicalBody: signed.canonicalBody,
      presentedSignature: signed.headers[WEBHOOK_SIGNATURE_HEADER],
      presentedTimestamp: signed.headers[WEBHOOK_TIMESTAMP_HEADER],
      now: () => t,
    });
    expect(r).toEqual({ ok: true });
  });

  it("rejects missing signature", () => {
    expect(
      verifyWebhook({
        hmacKey: KEY,
        canonicalBody: "{}",
        presentedSignature: null,
        presentedTimestamp: "1700000000",
      }),
    ).toEqual({ ok: false, reason: "signature_missing" });
    expect(
      verifyWebhook({
        hmacKey: KEY,
        canonicalBody: "{}",
        presentedSignature: "",
        presentedTimestamp: "1700000000",
      }),
    ).toEqual({ ok: false, reason: "signature_missing" });
  });

  it("rejects missing timestamp", () => {
    expect(
      verifyWebhook({
        hmacKey: KEY,
        canonicalBody: "{}",
        presentedSignature: "a".repeat(64),
        presentedTimestamp: null,
      }),
    ).toEqual({ ok: false, reason: "timestamp_missing" });
  });

  it("rejects malformed timestamp", () => {
    expect(
      verifyWebhook({
        hmacKey: KEY,
        canonicalBody: "{}",
        presentedSignature: "a".repeat(64),
        presentedTimestamp: "not-a-number",
      }),
    ).toEqual({ ok: false, reason: "timestamp_malformed" });
  });

  it("rejects stale timestamp beyond ±5 minutes (v4 §26.2)", () => {
    const t = 1_700_000_000_000;
    const signed = signWebhook({
      hmacKey: KEY,
      body: { x: 1 },
      now: () => t,
    });
    // 6 minutes later → stale
    expect(
      verifyWebhook({
        hmacKey: KEY,
        canonicalBody: signed.canonicalBody,
        presentedSignature: signed.headers[WEBHOOK_SIGNATURE_HEADER],
        presentedTimestamp: signed.headers[WEBHOOK_TIMESTAMP_HEADER],
        now: () => t + 6 * 60 * 1000,
      }),
    ).toEqual({ ok: false, reason: "timestamp_stale" });
    // 6 minutes earlier (replay protection in both directions)
    expect(
      verifyWebhook({
        hmacKey: KEY,
        canonicalBody: signed.canonicalBody,
        presentedSignature: signed.headers[WEBHOOK_SIGNATURE_HEADER],
        presentedTimestamp: signed.headers[WEBHOOK_TIMESTAMP_HEADER],
        now: () => t - 6 * 60 * 1000,
      }),
    ).toEqual({ ok: false, reason: "timestamp_stale" });
  });

  it("rejects invalid signature (right length, wrong bytes)", () => {
    const t = 1_700_000_000_000;
    const signed = signWebhook({
      hmacKey: KEY,
      body: { x: 1 },
      now: () => t,
    });
    expect(
      verifyWebhook({
        hmacKey: KEY,
        canonicalBody: signed.canonicalBody,
        presentedSignature: "0".repeat(64),
        presentedTimestamp: signed.headers[WEBHOOK_TIMESTAMP_HEADER],
        now: () => t,
      }),
    ).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it("rejects mismatched-length signature with signature_invalid", () => {
    expect(
      verifyWebhook({
        hmacKey: KEY,
        canonicalBody: "{}",
        presentedSignature: "abc",
        presentedTimestamp: Math.floor(Date.now() / 1000).toString(),
      }),
    ).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it("rejects when canonical_body has been tampered", () => {
    const t = 1_700_000_000_000;
    const signed = signWebhook({
      hmacKey: KEY,
      body: { x: 1 },
      now: () => t,
    });
    expect(
      verifyWebhook({
        hmacKey: KEY,
        canonicalBody: '{"x":2}',
        presentedSignature: signed.headers[WEBHOOK_SIGNATURE_HEADER],
        presentedTimestamp: signed.headers[WEBHOOK_TIMESTAMP_HEADER],
        now: () => t,
      }),
    ).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it("assertWebhookValid throws SecureCoreError on every reason", () => {
    expect(() =>
      assertWebhookValid({
        hmacKey: KEY,
        canonicalBody: "{}",
        presentedSignature: null,
        presentedTimestamp: "1",
      }),
    ).toThrow(SecureCoreError);
  });
});

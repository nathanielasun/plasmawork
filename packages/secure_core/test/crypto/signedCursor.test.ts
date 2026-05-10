/**
 * Signed cursor tests — Phase 0.5 / opt-in workstream close
 * (2026-05-09).
 *
 * Pins the four invariants the audit-fix recipe (v4 §10.3 + §22.2)
 * required:
 *
 *   1. Round-trip: encode → decode returns the original payload.
 *   2. Tampered payload: changing any field of the encoded envelope
 *      makes decode raise InputInvalidError.
 *   3. Wrong domain: a cursor signed for ``audit_events`` cannot be
 *      replayed against ``operator_events`` (the domain is mixed
 *      into the HMAC input, so the signature mismatches).
 *   4. Sort-stable canonicalization: payloads with the same fields
 *      in different insertion orders produce the same signature.
 */

import { describe, expect, it } from "vitest";

import {
  decodeSignedCursor,
  encodeSignedCursor,
} from "../../src/crypto/signedCursor.js";
import { InputInvalidError } from "../../src/errors/shapes.js";

const SECRET = "test_cursor_secret_at_least_32_bytes_for_hmac_xxxxxx";
const PAYLOAD = {
  created_at: "2026-05-08T00:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
};

describe("signedCursor", () => {
  it("round-trips the payload exactly", () => {
    const encoded = encodeSignedCursor(PAYLOAD, "audit_events", SECRET);
    const decoded = decodeSignedCursor(encoded, "audit_events", SECRET);
    expect(decoded).toEqual(PAYLOAD);
  });

  it("refuses a tampered payload (sig mismatch)", () => {
    const encoded = encodeSignedCursor(PAYLOAD, "audit_events", SECRET);
    // Decode the envelope, mutate the payload, re-encode without
    // re-signing. The decoder MUST reject the tamper.
    const envelope = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf-8"),
    ) as { p: Record<string, unknown>; s: string };
    envelope.p.id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const tampered = Buffer.from(JSON.stringify(envelope), "utf-8").toString(
      "base64",
    );
    expect(() =>
      decodeSignedCursor(tampered, "audit_events", SECRET),
    ).toThrow(InputInvalidError);
  });

  it("refuses a tampered signature", () => {
    const encoded = encodeSignedCursor(PAYLOAD, "audit_events", SECRET);
    const envelope = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf-8"),
    ) as { p: Record<string, unknown>; s: string };
    envelope.s = "0".repeat(envelope.s.length);
    const tampered = Buffer.from(JSON.stringify(envelope), "utf-8").toString(
      "base64",
    );
    expect(() =>
      decodeSignedCursor(tampered, "audit_events", SECRET),
    ).toThrow(InputInvalidError);
  });

  it("refuses a cursor signed for a different domain (no cross-route replay)", () => {
    const auditCursor = encodeSignedCursor(PAYLOAD, "audit_events", SECRET);
    expect(() =>
      decodeSignedCursor(auditCursor, "operator_events", SECRET),
    ).toThrow(InputInvalidError);
  });

  it("refuses a cursor signed with a different secret", () => {
    const cursor = encodeSignedCursor(PAYLOAD, "audit_events", SECRET);
    const otherSecret = "other_secret_definitely_not_the_one_xxxxxxxxxxxxxxx";
    expect(() =>
      decodeSignedCursor(cursor, "audit_events", otherSecret),
    ).toThrow(InputInvalidError);
  });

  it("refuses non-base64 input", () => {
    expect(() =>
      decodeSignedCursor("!!!not base64!!!", "audit_events", SECRET),
    ).toThrow(InputInvalidError);
  });

  it("refuses an envelope without a signature field", () => {
    const noSig = Buffer.from(
      JSON.stringify({ p: PAYLOAD }),
      "utf-8",
    ).toString("base64");
    expect(() =>
      decodeSignedCursor(noSig, "audit_events", SECRET),
    ).toThrow(InputInvalidError);
  });

  it("treats payloads with the same fields in different orders as equivalent", () => {
    // Insertion order should NOT affect the signature — the
    // canonicalizer sorts keys before HMAC.
    const a = encodeSignedCursor(
      { id: PAYLOAD.id, created_at: PAYLOAD.created_at },
      "audit_events",
      SECRET,
    );
    const b = encodeSignedCursor(
      { created_at: PAYLOAD.created_at, id: PAYLOAD.id },
      "audit_events",
      SECRET,
    );
    expect(a).toBe(b);
  });

  it("requires a non-empty secret on encode", () => {
    expect(() =>
      encodeSignedCursor(PAYLOAD, "audit_events", ""),
    ).toThrow(/non-empty string/);
  });

  it("requires a non-empty secret on decode", () => {
    const cursor = encodeSignedCursor(PAYLOAD, "audit_events", SECRET);
    expect(() =>
      decodeSignedCursor(cursor, "audit_events", ""),
    ).toThrow(/non-empty string/);
  });
});

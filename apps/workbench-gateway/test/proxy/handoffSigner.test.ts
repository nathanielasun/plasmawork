/**
 * Workbench handoff signer — Phase 0.5 / Phase E (2026-05-09).
 *
 * Pins:
 *   - Payload composition is stable: same input → same payload bytes
 *     across runs.
 *   - Roles ordering is canonicalized (alphabetical) so signature is
 *     order-independent.
 *   - HMAC signature changes when ANY field changes (sentinel test
 *     for each field).
 *   - verifyHandoffSignature is constant-time (timing-safe compare on
 *     a same-length input).
 *   - isWithinReplayWindow boundary cases (exactly 30s, 31s, NaN).
 *   - buildHandoffHeaders sets all 7 headers and only the 7.
 */

import { describe, it, expect } from "vitest";

import {
  HANDOFF_HEADERS,
  HANDOFF_HEADER_NAMES,
  HANDOFF_REPLAY_WINDOW_SEC,
  buildHandoffHeaders,
  buildHandoffPayload,
  isWithinReplayWindow,
  signHandoffPayload,
  verifyHandoffSignature,
  type HandoffPayload,
} from "../../src/proxy/handoffSigner.js";

const SECRET = "Aa!23456789012345678901234567890123456"; // 38 bytes

const PAYLOAD: HandoffPayload = {
  userId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  workspaceSlug: "shared-public-experiments",
  roles: ["WorkspaceAdmin", "Researcher"],
  requestId: "33333333-3333-4333-8333-333333333333",
  issuedAtSec: 1_700_000_000,
};

describe("handoffSigner — payload composition", () => {
  it("buildHandoffPayload uses pipe-delimited canonical form", () => {
    const out = buildHandoffPayload(PAYLOAD);
    expect(out).toBe(
      [
        PAYLOAD.userId,
        PAYLOAD.workspaceId,
        PAYLOAD.workspaceSlug,
        "Researcher,WorkspaceAdmin",
        PAYLOAD.requestId,
        String(PAYLOAD.issuedAtSec),
      ].join("|"),
    );
  });

  it("buildHandoffPayload sorts roles alphabetically (order-independent)", () => {
    const a = buildHandoffPayload(PAYLOAD);
    const b = buildHandoffPayload({
      ...PAYLOAD,
      roles: ["Researcher", "WorkspaceAdmin"],
    });
    expect(a).toBe(b);
  });
});

describe("handoffSigner — HMAC signature", () => {
  it("signHandoffPayload returns a 64-hex-char SHA-256 signature", () => {
    const sig = signHandoffPayload(PAYLOAD, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the same payload + secret produces the same signature (deterministic)", () => {
    expect(signHandoffPayload(PAYLOAD, SECRET)).toBe(
      signHandoffPayload(PAYLOAD, SECRET),
    );
  });

  it("changing any payload field changes the signature", () => {
    const baseline = signHandoffPayload(PAYLOAD, SECRET);
    const variations: Array<HandoffPayload> = [
      { ...PAYLOAD, userId: "00000000-0000-4000-8000-000000000000" },
      {
        ...PAYLOAD,
        workspaceId: "00000000-0000-4000-8000-000000000000",
      },
      { ...PAYLOAD, workspaceSlug: "different-slug" },
      { ...PAYLOAD, roles: ["Viewer"] },
      {
        ...PAYLOAD,
        requestId: "00000000-0000-4000-8000-000000000000",
      },
      { ...PAYLOAD, issuedAtSec: PAYLOAD.issuedAtSec + 1 },
    ];
    for (const v of variations) {
      expect(signHandoffPayload(v, SECRET)).not.toBe(baseline);
    }
  });

  it("changing the secret changes the signature", () => {
    expect(signHandoffPayload(PAYLOAD, SECRET)).not.toBe(
      signHandoffPayload(PAYLOAD, SECRET + "x"),
    );
  });

  it("signHandoffPayload throws on empty secret", () => {
    expect(() => signHandoffPayload(PAYLOAD, "")).toThrow();
  });
});

describe("handoffSigner — verifyHandoffSignature", () => {
  it("returns true for a matching signature (constant-time hex compare)", () => {
    const sig = signHandoffPayload(PAYLOAD, SECRET);
    expect(verifyHandoffSignature(PAYLOAD, sig, SECRET)).toBe(true);
  });

  it("returns false for a forged signature of the same length", () => {
    const sig = signHandoffPayload(PAYLOAD, SECRET);
    const flipped = sig
      .slice(0, -2)
      .concat(sig.slice(-2) === "00" ? "ff" : "00");
    expect(verifyHandoffSignature(PAYLOAD, flipped, SECRET)).toBe(false);
  });

  it("returns false when the expected hex is the wrong length (no length oracle)", () => {
    expect(verifyHandoffSignature(PAYLOAD, "ab", SECRET)).toBe(false);
  });
});

describe("handoffSigner — buildHandoffHeaders", () => {
  it("returns exactly the 7 documented headers", () => {
    const headers = buildHandoffHeaders(PAYLOAD, SECRET);
    expect(Object.keys(headers).sort()).toEqual([...HANDOFF_HEADER_NAMES].sort());
  });

  it("the signature header equals signHandoffPayload(...)", () => {
    const headers = buildHandoffHeaders(PAYLOAD, SECRET);
    expect(headers[HANDOFF_HEADERS.SIGNATURE]).toBe(
      signHandoffPayload(PAYLOAD, SECRET),
    );
  });

  it("issued-at is the unix-second integer as a string", () => {
    const headers = buildHandoffHeaders(PAYLOAD, SECRET);
    expect(headers[HANDOFF_HEADERS.ISSUED_AT]).toBe("1700000000");
  });
});

describe("handoffSigner — replay window", () => {
  it("HANDOFF_REPLAY_WINDOW_SEC is 30 (matches the FastAPI middleware default)", () => {
    expect(HANDOFF_REPLAY_WINDOW_SEC).toBe(30);
  });

  it("accepts a payload exactly at the window boundary (delta == 30)", () => {
    expect(isWithinReplayWindow(1_700_000_000, 1_700_000_030)).toBe(true);
  });

  it("rejects a payload outside the window (delta == 31)", () => {
    expect(isWithinReplayWindow(1_700_000_000, 1_700_000_031)).toBe(false);
  });

  it("rejects NaN inputs", () => {
    expect(isWithinReplayWindow(Number.NaN, 1_700_000_000)).toBe(false);
    expect(isWithinReplayWindow(1_700_000_000, Number.NaN)).toBe(false);
  });

  it("accepts past payloads within the window (clock-skew tolerance)", () => {
    expect(isWithinReplayWindow(1_700_000_030, 1_700_000_000)).toBe(true);
  });
});

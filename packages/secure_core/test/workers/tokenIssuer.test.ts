/**
 * L3.8 — worker token issuer / verifier tests.
 *
 * Pins the v4 §18.1 invariants:
 *   - Token bound to one run_id; cross-run use refused.
 *   - Closed capability set; required capability missing → refused.
 *   - Expiry enforced from claims via injected clock.
 *   - HMAC mismatch refused; payload tampering refused.
 *   - Revocation list short-circuits.
 *   - Issuance rejects unknown capabilities.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";

import {
  issueWorkerToken,
  verifyWorkerToken,
  assertWorkerTokenValid,
  WORKER_CAPABILITIES,
} from "../../src/workers/tokenIssuer.js";
import { SecureCoreError } from "../../src/errors/shapes.js";

const KEY = randomBytes(32);

const RUN = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  capsuleId: "33333333-3333-4333-8333-333333333333",
  capsuleVersionId: "44444444-4444-4444-8444-444444444444",
};

describe("issueWorkerToken", () => {
  it("mints a token with all default capabilities", () => {
    const t = issueWorkerToken({ hmacKey: KEY, run: RUN, now: () => 1_000_000 });
    expect(t.raw).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    expect(t.claims.run_id).toBe(RUN.id);
    expect(t.claims.workspace_id).toBe(RUN.workspaceId);
    expect(t.claims.capabilities).toEqual([
      "run.read",
      "capsule.read",
      "run.write_artifact",
      "run.emit_event",
    ]);
    expect(t.claims.issued_at).toBe(1000); // ms / 1000
    expect(t.claims.expires_at).toBe(1000 + 3600);
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a narrowed capability set", () => {
    const t = issueWorkerToken({
      hmacKey: KEY,
      run: RUN,
      capabilities: ["run.read"],
    });
    expect(t.claims.capabilities).toEqual(["run.read"]);
  });

  it("refuses unknown capabilities at issuance", () => {
    expect(() =>
      issueWorkerToken({
        hmacKey: KEY,
        run: RUN,
        capabilities: ["run.read", "platform:audit_read" as never],
      }),
    ).toThrow(/not in WORKER_CAPABILITIES/);
  });

  it("refuses non-positive ttl", () => {
    expect(() =>
      issueWorkerToken({ hmacKey: KEY, run: RUN, ttlSeconds: 0 }),
    ).toThrow(/positive integer/);
    expect(() =>
      issueWorkerToken({ hmacKey: KEY, run: RUN, ttlSeconds: -10 }),
    ).toThrow(/positive integer/);
  });
});

describe("verifyWorkerToken", () => {
  it("happy path: same run, capability granted, before expiry", () => {
    const t = issueWorkerToken({ hmacKey: KEY, run: RUN, now: () => 1_000_000 });
    const r = verifyWorkerToken({
      hmacKey: KEY,
      raw: t.raw,
      expectedRunId: RUN.id,
      requiredCapability: "run.write_artifact",
      now: () => 1_500_000, // 500s in
    });
    expect(r.ok).toBe(true);
  });

  it("§29 #44 — token for run A refused on run B", () => {
    const t = issueWorkerToken({ hmacKey: KEY, run: RUN });
    const r = verifyWorkerToken({
      hmacKey: KEY,
      raw: t.raw,
      expectedRunId: "55555555-5555-4555-8555-555555555555",
      requiredCapability: "run.read",
    });
    expect(r).toEqual({ ok: false, reason: "run_mismatch" });
  });

  it("required capability missing → capability_missing", () => {
    const t = issueWorkerToken({
      hmacKey: KEY,
      run: RUN,
      capabilities: ["run.read"],
    });
    const r = verifyWorkerToken({
      hmacKey: KEY,
      raw: t.raw,
      expectedRunId: RUN.id,
      requiredCapability: "run.write_artifact",
    });
    expect(r).toEqual({ ok: false, reason: "capability_missing" });
  });

  it("expired token → expired", () => {
    const t = issueWorkerToken({
      hmacKey: KEY,
      run: RUN,
      ttlSeconds: 60,
      now: () => 1_000_000,
    });
    const r = verifyWorkerToken({
      hmacKey: KEY,
      raw: t.raw,
      expectedRunId: RUN.id,
      requiredCapability: "run.read",
      now: () => 1_000_000 + 120_000, // 120s later — past 60s ttl
    });
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("HMAC signed with a different key → signature_mismatch", () => {
    const t = issueWorkerToken({ hmacKey: KEY, run: RUN });
    const otherKey = randomBytes(32);
    const r = verifyWorkerToken({
      hmacKey: otherKey,
      raw: t.raw,
      expectedRunId: RUN.id,
      requiredCapability: "run.read",
    });
    expect(r).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("malformed token → malformed", () => {
    const r1 = verifyWorkerToken({
      hmacKey: KEY,
      raw: "no-dot-no-signature",
      expectedRunId: RUN.id,
      requiredCapability: "run.read",
    });
    expect(r1).toEqual({ ok: false, reason: "malformed" });
    const r2 = verifyWorkerToken({
      hmacKey: KEY,
      raw: "%%%.deadbeef",
      expectedRunId: RUN.id,
      requiredCapability: "run.read",
    });
    expect(r2).toEqual({ ok: false, reason: "malformed" });
  });

  it("payload tampered (different signature length, wrong sig) → signature_mismatch", () => {
    const t = issueWorkerToken({ hmacKey: KEY, run: RUN });
    // Replace last 4 hex chars of signature with zeros — equal length, wrong bytes.
    const flipped = t.raw.slice(0, -4) + "0000";
    const r = verifyWorkerToken({
      hmacKey: KEY,
      raw: flipped,
      expectedRunId: RUN.id,
      requiredCapability: "run.read",
    });
    expect(r).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("revocation list refuses an otherwise-valid token", () => {
    const t = issueWorkerToken({ hmacKey: KEY, run: RUN });
    const r = verifyWorkerToken({
      hmacKey: KEY,
      raw: t.raw,
      expectedRunId: RUN.id,
      requiredCapability: "run.read",
      revokedTokenHashes: new Set([t.tokenHash]),
    });
    expect(r).toEqual({ ok: false, reason: "revoked" });
  });
});

describe("assertWorkerTokenValid", () => {
  it("returns claims on success", () => {
    const t = issueWorkerToken({ hmacKey: KEY, run: RUN });
    const claims = assertWorkerTokenValid({
      hmacKey: KEY,
      raw: t.raw,
      expectedRunId: RUN.id,
      requiredCapability: "run.read",
    });
    expect(claims.run_id).toBe(RUN.id);
  });

  it("throws WORKER_UPLOAD_DENIED on rejection", () => {
    expect(() =>
      assertWorkerTokenValid({
        hmacKey: KEY,
        raw: "bad.token",
        expectedRunId: RUN.id,
        requiredCapability: "run.read",
      }),
    ).toThrow(SecureCoreError);
  });
});

describe("WORKER_CAPABILITIES enumeration", () => {
  it("matches the v4 §18.1 closed set exactly", () => {
    expect(new Set(WORKER_CAPABILITIES)).toEqual(
      new Set([
        "run.read",
        "capsule.read",
        "run.write_artifact",
        "run.emit_event",
      ]),
    );
  });
});

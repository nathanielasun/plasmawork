import { describe, expect, it } from "vitest";

import {
  PeriodicAuditChainVerifier,
  type VerifierByLogType,
} from "../../src/audit/periodicVerifier.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { VerifyReport } from "../../src/audit/index.js";

function verifier(report: VerifyReport): { verifyAll: () => Promise<VerifyReport> } {
  return { verifyAll: async () => report };
}

function throwingVerifier(): { verifyAll: () => Promise<VerifyReport> } {
  return {
    verifyAll: async () => {
      throw new Error("database unavailable");
    },
  };
}

describe("PeriodicAuditChainVerifier", () => {
  it("runs all three log-chain verifiers and emits success audit", async () => {
    const calls: Array<{ action: string; result: string; metadata?: unknown }> = [];
    const auditLogger = {
      write: async (input: {
        action: string;
        result: string;
        metadata?: unknown;
      }) => {
        calls.push(input);
      },
    } as unknown as AuditLogger;
    const ok: VerifyReport = { ok: true, rowsVerified: 1, tipHash: "tip" };
    const job = new PeriodicAuditChainVerifier({
      verifiers: {
        audit: verifier(ok),
        provenance: verifier(ok),
        operator: verifier(ok),
      } as VerifierByLogType,
      auditLogger,
      intervalMs: 60_000,
      requestId: "periodic",
    });

    const report = await job.runOnce();

    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.logType)).toEqual([
      "audit",
      "provenance",
      "operator",
    ]);
    expect(calls).toMatchObject([
      {
        action: "log_chain.verification_succeeded",
        result: "succeeded",
        metadata: { count: 3 },
      },
    ]);
  });

  it("emits a failure audit for every failed chain", async () => {
    const calls: Array<{ action: string; result: string; metadata?: unknown }> = [];
    const auditLogger = {
      write: async (input: {
        action: string;
        result: string;
        metadata?: unknown;
      }) => {
        calls.push(input);
      },
    } as unknown as AuditLogger;
    const ok: VerifyReport = { ok: true, rowsVerified: 1, tipHash: "tip" };
    const bad: VerifyReport = {
      ok: false,
      rowsVerified: 0,
      firstFailureRowId: "row-1",
      failureReason: "external_anchor_mismatch",
    };
    const job = new PeriodicAuditChainVerifier({
      verifiers: {
        audit: verifier(ok),
        provenance: verifier(bad),
        operator: verifier(bad),
      } as VerifierByLogType,
      auditLogger,
      intervalMs: 60_000,
      requestId: "periodic",
    });

    const report = await job.runOnce();

    expect(report.ok).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      action: "log_chain.verification_failed",
      result: "failed",
      metadata: { error_code: "external_anchor_mismatch" },
    });
  });

  it("turns verifier exceptions into failed audit events", async () => {
    const calls: Array<{ action: string; result: string; metadata?: unknown }> = [];
    const auditLogger = {
      write: async (input: {
        action: string;
        result: string;
        metadata?: unknown;
      }) => {
        calls.push(input);
      },
    } as unknown as AuditLogger;
    const ok: VerifyReport = { ok: true, rowsVerified: 1, tipHash: "tip" };
    const job = new PeriodicAuditChainVerifier({
      verifiers: {
        audit: throwingVerifier(),
        provenance: verifier(ok),
        operator: verifier(ok),
      } as VerifierByLogType,
      auditLogger,
      intervalMs: 60_000,
      requestId: "periodic",
    });

    const report = await job.runOnce();

    expect(report.ok).toBe(false);
    expect(report.results[0]?.report).toMatchObject({
      ok: false,
      failureReason: "verifier_error",
      rowsVerified: 0,
    });
    expect(calls).toMatchObject([
      {
        action: "log_chain.verification_failed",
        result: "failed",
        metadata: { error_code: "verifier_error", count: 0 },
      },
    ]);
  });
});

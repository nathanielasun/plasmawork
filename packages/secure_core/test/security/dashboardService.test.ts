import { describe, expect, it } from "vitest";

import {
  DENIED_ACCESS_DASHBOARD_ACTIONS,
  SANDBOX_DASHBOARD_ACTIONS,
  SecurityDashboardService,
  SqlSecurityDashboardDataSource,
  type DashboardAuditAction,
  type SecurityDashboardDataSource,
} from "../../src/security/dashboardService.js";
import type { SecureCorePool } from "../../src/db/pool.js";
import type { VerifyReport } from "../../src/audit/index.js";

function verifier(report: VerifyReport): { verifyAll: () => Promise<VerifyReport> } {
  return { verifyAll: async () => report };
}

function throwingVerifier(): { verifyAll: () => Promise<VerifyReport> } {
  return {
    verifyAll: async () => {
      throw new Error("verifier offline");
    },
  };
}

function source(): SecurityDashboardDataSource {
  return {
    latestAnchor: async (logType) => ({
      committedAt: logType === "audit" ? "2026-05-07T00:09:00.000Z" : null,
      externalAnchorUri:
        logType === "audit" ? "s3://bucket/audit?versionId=1" : null,
    }),
    countAuditEvents: async (actions: readonly DashboardAuditAction[]) => {
      if (actions === DENIED_ACCESS_DASHBOARD_ACTIONS) {
        return [
          { action: "permission.denied", count: 3 },
          { action: "rate_limit.triggered", count: 2 },
        ];
      }
      if (actions === SANDBOX_DASHBOARD_ACTIONS) {
        return [{ action: "sandbox.violation", count: 1 }];
      }
      return [];
    },
  };
}

describe("SecurityDashboardService", () => {
  it("builds a stable snapshot from live chain and audit-counter sources", async () => {
    const ok: VerifyReport = { ok: true, rowsVerified: 2, tipHash: "tip" };
    const service = new SecurityDashboardService({
      source: source(),
      verifiers: {
        audit: verifier(ok),
        provenance: verifier(ok),
        operator: verifier(ok),
      },
      now: () => new Date("2026-05-07T00:10:00.000Z"),
      windowMs: 60_000,
    });

    const snapshot = await service.getSecurityDashboard();

    expect(snapshot.generatedAt).toBe("2026-05-07T00:10:00.000Z");
    expect(snapshot.chains).toHaveLength(3);
    expect(snapshot.chains[0]).toMatchObject({
      logType: "audit",
      latestExternalAnchorUri: "s3://bucket/audit?versionId=1",
      anchorLagMs: 60_000,
    });
    expect(snapshot.deniedAccess.find((c) => c.name === "permission.denied"))
      .toMatchObject({ count: 3 });
    expect(snapshot.sandboxViolations).toEqual([
      {
        name: "sandbox.violation",
        count: 1,
        windowMs: 60_000,
        status: "warning",
      },
    ]);
  });

  it("converts thrown verifier dependencies into critical dashboard state", async () => {
    const ok: VerifyReport = { ok: true, rowsVerified: 2, tipHash: "tip" };
    const service = new SecurityDashboardService({
      source: source(),
      verifiers: {
        audit: throwingVerifier(),
        provenance: verifier(ok),
        operator: verifier(ok),
      },
      now: () => new Date("2026-05-07T00:10:00.000Z"),
    });

    const snapshot = await service.getSecurityDashboard();

    expect(snapshot.status).toBe("critical");
    expect(snapshot.chains[0]).toMatchObject({
      logType: "audit",
      ok: false,
      failureReason: "verifier_error",
    });
  });

  it("requires audit_read role for SQL-backed dashboard source", () => {
    expect(
      () =>
        new SqlSecurityDashboardDataSource({
          auditReadPool: {
            role: "app",
          } as SecureCorePool,
        }),
    ).toThrow(/audit_read/);
  });
});

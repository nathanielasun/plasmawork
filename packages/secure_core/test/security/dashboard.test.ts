import { describe, expect, it } from "vitest";

import {
  buildSecurityDashboard,
  SECURITY_DASHBOARD_THRESHOLDS,
} from "../../src/security/dashboard.js";

describe("security dashboard aggregation", () => {
  it("reports healthy chains when anchors are fresh and no spikes exist", () => {
    const now = new Date("2026-05-07T00:10:00.000Z");
    const dashboard = buildSecurityDashboard({
      now,
      chains: [
        {
          logType: "audit",
          ok: true,
          rowsVerified: 3,
          tipHash: "abc",
          latestAnchorCommittedAt: "2026-05-07T00:09:00.000Z",
          latestExternalAnchorUri: "s3://bucket/key?versionId=1",
        },
      ],
      deniedAccess: [{ name: "permission.denied", count: 0, windowMs: 60_000 }],
      sandboxViolations: [{ name: "sandbox.violation", count: 0, windowMs: 60_000 }],
    });

    expect(dashboard.status).toBe("healthy");
    expect(dashboard.chains[0]?.anchorLagMs).toBe(60_000);
  });

  it("escalates stale anchors, chain failures, denied spikes, and sandbox violations", () => {
    const now = new Date("2026-05-07T00:30:00.000Z");
    const dashboard = buildSecurityDashboard({
      now,
      chains: [
        {
          logType: "audit",
          ok: false,
          rowsVerified: 0,
          tipHash: null,
          failureReason: "external_anchor_mismatch",
          latestAnchorCommittedAt: "2026-05-07T00:00:00.000Z",
          latestExternalAnchorUri: "s3://bucket/key?versionId=1",
        },
      ],
      deniedAccess: [
        {
          name: "permission.denied",
          count: SECURITY_DASHBOARD_THRESHOLDS.deniedSpikeCriticalCount,
          windowMs: 60_000,
        },
      ],
      sandboxViolations: [
        {
          name: "sandbox.violation",
          count: SECURITY_DASHBOARD_THRESHOLDS.sandboxViolationWarningCount,
          windowMs: 60_000,
        },
      ],
    });

    expect(dashboard.status).toBe("critical");
    expect(dashboard.chains[0]?.status).toBe("critical");
    expect(dashboard.deniedAccess[0]?.status).toBe("critical");
    expect(dashboard.sandboxViolations[0]?.status).toBe("warning");
  });
});

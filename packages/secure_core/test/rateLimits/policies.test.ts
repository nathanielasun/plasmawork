import { describe, expect, it } from "vitest";

import {
  ABUSE_CONTROL_SURFACES,
  RATE_LIMIT_POLICIES,
  assertRateLimitPolicyCoverage,
  buildSecurityRouteRateLimitMiddleware,
  keyExtractorForPolicy,
  findRateLimitPolicy,
  missingAbuseControlSurfaces,
} from "../../src/rateLimits/policies.js";
import type { FastifyRequest } from "fastify";
import { InMemoryRateLimitStore } from "../../src/middleware/enforceRateLimit.js";
import type { AuditLogger } from "../../src/audit/logger.js";

function request(shape: Partial<FastifyRequest>): FastifyRequest {
  return {
    ip: "203.0.113.10",
    headers: {},
    params: {},
    ...shape,
  } as FastifyRequest;
}

describe("rate-limit policy coverage", () => {
  it("covers every required abuse-control surface", () => {
    expect(missingAbuseControlSurfaces()).toEqual([]);
    expect(() => assertRateLimitPolicyCoverage()).not.toThrow();
    expect(new Set(RATE_LIMIT_POLICIES.map((p) => p.surface))).toEqual(
      new Set(ABUSE_CONTROL_SURFACES),
    );
  });

  it("keeps high-risk endpoints named and bounded", () => {
    expect(findRateLimitPolicy("artifact.export")).toMatchObject({
      surface: "exports",
      routePattern:
        "POST /workspaces/:workspaceId/artifacts/:artifactId/export",
    });
    for (const policy of RATE_LIMIT_POLICIES) {
      expect(policy.limit).toBeGreaterThan(0);
      expect(policy.windowMs).toBeGreaterThan(0);
    }
  });

  it("fails loudly when a surface has no policy", () => {
    expect(() =>
      assertRateLimitPolicyCoverage(
        RATE_LIMIT_POLICIES.filter((p) => p.surface !== "uploads"),
      ),
    ).toThrow(/uploads/);
  });

  it("derives runtime limiter keys from each policy scope", () => {
    expect(
      keyExtractorForPolicy(findRateLimitPolicy("auth.password_reset.request"))(
        request({ headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" } }),
      ),
    ).toBe("ip:198.51.100.7");

    expect(
      keyExtractorForPolicy(findRateLimitPolicy("approval.request"))(
        request({ params: { workspaceId: "ws-approval" } }),
      ),
    ).toBe("workspace:ws-approval");

    expect(
      keyExtractorForPolicy(findRateLimitPolicy("run.create"))(
        request({ params: { workspaceId: "ws-1" } }),
      ),
    ).toBe("workspace:ws-1");

    expect(
      keyExtractorForPolicy({
        endpoint: "synthetic.account",
        surface: "approvals",
        limit: 1,
        windowMs: 1,
        keyScope: "account",
        routePattern: "POST /synthetic",
      })(
        request({
          auth: {
            userId: "user-1",
            sessionId: "sess-1",
            actorType: "human",
            assuranceLevel: "aal2",
          },
        }),
      ),
    ).toBe("account:user-1");

    expect(
      keyExtractorForPolicy(findRateLimitPolicy("worker.upload"))(
        request({ headers: { "x-worker-token": "raw-worker-token" } }),
      ),
    ).toMatch(/^worker-token:[a-f0-9]{64}$/);
  });

  it("fails closed when scoped policies are registered before their context exists", () => {
    expect(() =>
      keyExtractorForPolicy({
        endpoint: "synthetic.account",
        surface: "approvals",
        limit: 1,
        windowMs: 1,
        keyScope: "account",
        routePattern: "POST /synthetic",
      })(request({})),
    ).toThrow(/after requireAuth/);

    expect(() =>
      keyExtractorForPolicy(findRateLimitPolicy("run.create"))(request({})),
    ).toThrow(/workspace context/);
  });

  it("builds named middleware for every route surface that needs abuse controls", () => {
    const auditLogger = {
      write: async () => ({ id: "audit-row" }),
    } as unknown as AuditLogger;
    const bundle = buildSecurityRouteRateLimitMiddleware({
      store: new InMemoryRateLimitStore(),
      auditLogger,
    });

    expect(bundle.auth.enforcePasswordResetRequestRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.auth.enforcePasswordResetConsumeRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.auth.enforceEmailVerifyRequestRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.auth.enforceEmailVerifyConsumeRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.auth.enforceMfaRecoveryRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.runs.enforceRunCreateRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.approvals.enforceApprovalRequestRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.approvals.enforceApprovalConsumeRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.approvals.enforceApprovalDenyRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.artifacts.enforceArtifactExportRateLimit.name).toBe(
      "enforceRateLimit",
    );
    expect(bundle.workers.workerUploadRateLimit.name).toBe("enforceRateLimit");
  });
});

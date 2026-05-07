import { createHash } from "node:crypto";

import type { FastifyRequest } from "fastify";

import type { AuditLogger } from "../audit/logger.js";
import { InternalError } from "../errors/shapes.js";
import {
  enforceRateLimit,
  type RateLimitKeyExtractor,
  type RateLimitStore,
} from "../middleware/enforceRateLimit.js";
import type { NamedMiddleware } from "../middleware/compose.js";

export const ABUSE_CONTROL_SURFACES = [
  "auth",
  "uploads",
  "runs",
  "approvals",
  "exports",
] as const;

export type AbuseControlSurface = (typeof ABUSE_CONTROL_SURFACES)[number];

export type RateLimitKeyScope = "ip" | "account" | "workspace" | "worker";

export interface RateLimitPolicy {
  readonly endpoint: string;
  readonly surface: AbuseControlSurface;
  readonly limit: number;
  readonly windowMs: number;
  readonly keyScope: RateLimitKeyScope;
  readonly routePattern: string;
}

export const RATE_LIMIT_POLICIES = [
  {
    endpoint: "auth.password_reset.request",
    surface: "auth",
    limit: 5,
    windowMs: 15 * 60_000,
    keyScope: "ip",
    routePattern: "POST /auth/password-reset/request",
  },
  {
    endpoint: "auth.password_reset.consume",
    surface: "auth",
    limit: 10,
    windowMs: 15 * 60_000,
    keyScope: "ip",
    routePattern: "POST /auth/password-reset/consume",
  },
  {
    endpoint: "auth.email_verify.request",
    surface: "auth",
    limit: 5,
    windowMs: 15 * 60_000,
    keyScope: "ip",
    routePattern: "POST /auth/email-verify/request",
  },
  {
    endpoint: "auth.email_verify.consume",
    surface: "auth",
    limit: 10,
    windowMs: 15 * 60_000,
    keyScope: "ip",
    routePattern: "POST /auth/email-verify/consume",
  },
  {
    endpoint: "auth.mfa_recovery",
    surface: "auth",
    limit: 5,
    windowMs: 15 * 60_000,
    keyScope: "ip",
    routePattern: "POST /auth/mfa-recovery",
  },
  {
    endpoint: "worker.upload",
    surface: "uploads",
    limit: 60,
    windowMs: 60_000,
    keyScope: "worker",
    routePattern: "POST /api/workers/uploads",
  },
  {
    endpoint: "run.create",
    surface: "runs",
    limit: 30,
    windowMs: 60_000,
    keyScope: "workspace",
    routePattern: "POST /workspaces/:workspaceId/capsules/:capsuleId/runs",
  },
  {
    endpoint: "approval.request",
    surface: "approvals",
    limit: 30,
    windowMs: 60_000,
    keyScope: "workspace",
    routePattern: "POST /workspaces/:workspaceId/approval-requests",
  },
  {
    endpoint: "approval.consume",
    surface: "approvals",
    limit: 20,
    windowMs: 60_000,
    keyScope: "workspace",
    routePattern: "POST /workspaces/:workspaceId/approval-requests/:id/approve",
  },
  {
    endpoint: "approval.deny",
    surface: "approvals",
    limit: 20,
    windowMs: 60_000,
    keyScope: "workspace",
    routePattern: "POST /workspaces/:workspaceId/approval-requests/:id/deny",
  },
  {
    endpoint: "artifact.export",
    surface: "exports",
    limit: 10,
    windowMs: 60_000,
    keyScope: "workspace",
    routePattern: "POST /workspaces/:workspaceId/artifacts/:artifactId/export",
  },
] as const satisfies readonly RateLimitPolicy[];

export type RateLimitEndpoint = (typeof RATE_LIMIT_POLICIES)[number]["endpoint"];

export function findRateLimitPolicy(
  endpoint: RateLimitEndpoint,
): RateLimitPolicy {
  const hit = RATE_LIMIT_POLICIES.find((policy) => policy.endpoint === endpoint);
  if (hit === undefined) {
    throw new Error(`unknown rate-limit endpoint policy: ${endpoint}`);
  }
  return hit;
}

export function missingAbuseControlSurfaces(
  policies: readonly RateLimitPolicy[] = RATE_LIMIT_POLICIES,
): AbuseControlSurface[] {
  return ABUSE_CONTROL_SURFACES.filter(
    (surface) => !policies.some((policy) => policy.surface === surface),
  );
}

export function assertRateLimitPolicyCoverage(
  policies: readonly RateLimitPolicy[] = RATE_LIMIT_POLICIES,
): void {
  const missing = missingAbuseControlSurfaces(policies);
  if (missing.length > 0) {
    throw new Error(
      `missing rate-limit policies for surfaces: ${missing.join(", ")}`,
    );
  }
}

export interface BuildPolicyRateLimitOptions {
  readonly policy: RateLimitPolicy;
  readonly store: RateLimitStore;
  readonly auditLogger: AuditLogger;
  /**
   * Optional escape hatch for special routes. Most callers should rely
   * on the policy's keyScope so the declared abuse-control model and
   * the runtime limiter cannot drift.
   */
  readonly keyExtractor?: RateLimitKeyExtractor;
}

export interface BuildRateLimitForEndpointOptions {
  readonly endpoint: RateLimitEndpoint;
  readonly store: RateLimitStore;
  readonly auditLogger: AuditLogger;
  readonly keyExtractor?: RateLimitKeyExtractor;
}

function paramsRecord(req: FastifyRequest): Record<string, unknown> {
  return typeof req.params === "object" && req.params !== null
    ? (req.params as Record<string, unknown>)
    : {};
}

function ipLimitKey(req: FastifyRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  const firstForwarded =
    typeof fwd === "string" ? fwd.split(",")[0]!.trim() : "";
  const ip = firstForwarded.length > 0 ? firstForwarded : req.ip;
  return `ip:${ip}`;
}

function requireWorkspaceLimitKey(req: FastifyRequest): string {
  const paramWorkspaceId = paramsRecord(req).workspaceId;
  const workspaceId =
    req.workspace?.id ??
    (typeof paramWorkspaceId === "string" ? paramWorkspaceId : undefined);
  if (workspaceId === undefined || workspaceId.trim().length === 0) {
    throw new InternalError(
      "Workspace-scoped rate limit was registered without workspace context.",
      { endpoint: "rate_limit.policy_misconfigured" },
    );
  }
  return `workspace:${workspaceId}`;
}

function requireAccountLimitKey(req: FastifyRequest): string {
  if (req.auth === undefined) {
    throw new InternalError(
      "Account-scoped rate limit must run after requireAuth.",
      { endpoint: "rate_limit.policy_misconfigured" },
    );
  }
  return `account:${req.auth.userId}`;
}

function workerLimitKey(req: FastifyRequest): string {
  const presented = req.headers["x-worker-token"];
  if (typeof presented === "string" && presented.trim().length > 0) {
    const tokenHash = createHash("sha256").update(presented).digest("hex");
    return `worker-token:${tokenHash}`;
  }
  return `worker-ip:${req.ip}`;
}

export function keyExtractorForPolicy(
  policy: RateLimitPolicy,
): RateLimitKeyExtractor {
  switch (policy.keyScope) {
    case "ip":
      return ipLimitKey;
    case "account":
      return requireAccountLimitKey;
    case "workspace":
      return requireWorkspaceLimitKey;
    case "worker":
      return workerLimitKey;
  }
}

export function buildPolicyRateLimit(
  opts: BuildPolicyRateLimitOptions,
): NamedMiddleware {
  return enforceRateLimit({
    limit: opts.policy.limit,
    windowMs: opts.policy.windowMs,
    endpoint: opts.policy.endpoint,
    store: opts.store,
    auditLogger: opts.auditLogger,
    keyExtractor: opts.keyExtractor ?? keyExtractorForPolicy(opts.policy),
  });
}

export function buildRateLimitForEndpoint(
  opts: BuildRateLimitForEndpointOptions,
): NamedMiddleware {
  return buildPolicyRateLimit({
    policy: findRateLimitPolicy(opts.endpoint),
    store: opts.store,
    auditLogger: opts.auditLogger,
    keyExtractor: opts.keyExtractor,
  });
}

export interface SecurityRouteRateLimitMiddleware {
  readonly auth: {
    readonly enforcePasswordResetRequestRateLimit: NamedMiddleware;
    readonly enforcePasswordResetConsumeRateLimit: NamedMiddleware;
    readonly enforceEmailVerifyRequestRateLimit: NamedMiddleware;
    readonly enforceEmailVerifyConsumeRateLimit: NamedMiddleware;
    readonly enforceMfaRecoveryRateLimit: NamedMiddleware;
  };
  readonly runs: {
    readonly enforceRunCreateRateLimit: NamedMiddleware;
  };
  readonly approvals: {
    readonly enforceApprovalRequestRateLimit: NamedMiddleware;
    readonly enforceApprovalConsumeRateLimit: NamedMiddleware;
    readonly enforceApprovalDenyRateLimit: NamedMiddleware;
  };
  readonly artifacts: {
    readonly enforceArtifactExportRateLimit: NamedMiddleware;
  };
  readonly workers: {
    readonly workerUploadRateLimit: NamedMiddleware;
  };
}

export interface BuildSecurityRouteRateLimitsOptions {
  readonly store: RateLimitStore;
  readonly auditLogger: AuditLogger;
}

export function buildSecurityRouteRateLimitMiddleware(
  opts: BuildSecurityRouteRateLimitsOptions,
): SecurityRouteRateLimitMiddleware {
  const build = (endpoint: RateLimitEndpoint): NamedMiddleware =>
    buildRateLimitForEndpoint({
      endpoint,
      store: opts.store,
      auditLogger: opts.auditLogger,
    });

  return {
    auth: {
      enforcePasswordResetRequestRateLimit: build("auth.password_reset.request"),
      enforcePasswordResetConsumeRateLimit: build("auth.password_reset.consume"),
      enforceEmailVerifyRequestRateLimit: build("auth.email_verify.request"),
      enforceEmailVerifyConsumeRateLimit: build("auth.email_verify.consume"),
      enforceMfaRecoveryRateLimit: build("auth.mfa_recovery"),
    },
    runs: {
      enforceRunCreateRateLimit: build("run.create"),
    },
    approvals: {
      enforceApprovalRequestRateLimit: build("approval.request"),
      enforceApprovalConsumeRateLimit: build("approval.consume"),
      enforceApprovalDenyRateLimit: build("approval.deny"),
    },
    artifacts: {
      enforceArtifactExportRateLimit: build("artifact.export"),
    },
    workers: {
      workerUploadRateLimit: build("worker.upload"),
    },
  };
}

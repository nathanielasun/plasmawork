/**
 * Security-operations backend composition.
 *
 * This module is the production wiring seam for operator dashboard
 * routes and the periodic audit-chain verifier. It intentionally
 * registers only security-operations surfaces; the broader workbench
 * route graph remains composed by the host application.
 */

import type { FastifyInstance } from "fastify";

import {
  AuditChainVerifier,
  PeriodicAuditChainVerifier,
  type AuditLogger,
  type VerifierByLogType,
} from "../audit/index.js";
import type { SecureCorePool } from "../db/pool.js";
import {
  attachAuditActor,
  requireAuth,
  requirePlatformCapability,
} from "../middleware/index.js";
import { securityDashboardRoutes } from "../routes/securityDashboard.js";
import type { S3AnchorProvider } from "../audit/s3Provider.js";
import {
  SecurityDashboardService,
  SqlSecurityDashboardDataSource,
} from "./dashboardService.js";
import type { SecurityDashboardReader } from "./dashboard.js";

export interface BuildDashboardVerifiersOptions {
  readonly auditReadPool: SecureCorePool;
  readonly anchorProvider?: S3AnchorProvider;
}

export function buildDashboardVerifiers(
  opts: BuildDashboardVerifiersOptions,
): VerifierByLogType {
  return {
    audit: new AuditChainVerifier({
      pool: opts.auditReadPool,
      logType: "audit",
      anchorProvider: opts.anchorProvider,
    }),
    provenance: new AuditChainVerifier({
      pool: opts.auditReadPool,
      logType: "provenance",
      anchorProvider: opts.anchorProvider,
    }),
    operator: new AuditChainVerifier({
      pool: opts.auditReadPool,
      logType: "operator",
      anchorProvider: opts.anchorProvider,
    }),
  };
}

export interface RegisterSecurityOperationsOptions {
  readonly appPool: SecureCorePool;
  readonly auditReadPool: SecureCorePool;
  readonly auditLogger: AuditLogger;
  readonly anchorProvider?: S3AnchorProvider;
  readonly dashboardService?: SecurityDashboardReader;
  readonly dashboardVerifiers?: VerifierByLogType;
  readonly now?: () => Date;
  readonly dashboardWindowMs?: number;
}

export async function registerSecurityOperationsRoutes(
  app: FastifyInstance,
  opts: RegisterSecurityOperationsOptions,
): Promise<SecurityDashboardReader> {
  const verifiers =
    opts.dashboardVerifiers ??
    buildDashboardVerifiers({
      auditReadPool: opts.auditReadPool,
      anchorProvider: opts.anchorProvider,
    });
  const dashboardService =
    opts.dashboardService ??
    new SecurityDashboardService({
      source: new SqlSecurityDashboardDataSource({
        auditReadPool: opts.auditReadPool,
      }),
      verifiers,
      now: opts.now,
      windowMs: opts.dashboardWindowMs,
    });

  await app.register(securityDashboardRoutes, {
    service: dashboardService,
    auditLogger: opts.auditLogger,
    mw: {
      requireAuth: requireAuth({
        pool: opts.appPool,
        auditLogger: opts.auditLogger,
      }),
      attachAuditActor,
      requireOperatorAuditRead: requirePlatformCapability({
        capability: "platform:audit_read",
        pool: opts.appPool,
        auditLogger: opts.auditLogger,
      }),
    },
  });

  return dashboardService;
}

export interface StartPeriodicVerifierOptions {
  readonly auditReadPool: SecureCorePool;
  readonly auditLogger: AuditLogger;
  readonly requestId: string;
  readonly intervalMs: number;
  readonly anchorProvider?: S3AnchorProvider;
  readonly verifiers?: VerifierByLogType;
}

export function startPeriodicAuditChainVerifier(
  opts: StartPeriodicVerifierOptions,
): PeriodicAuditChainVerifier {
  const job = new PeriodicAuditChainVerifier({
    verifiers:
      opts.verifiers ??
      buildDashboardVerifiers({
        auditReadPool: opts.auditReadPool,
        anchorProvider: opts.anchorProvider,
      }),
    auditLogger: opts.auditLogger,
    requestId: opts.requestId,
    intervalMs: opts.intervalMs,
  });
  job.start();
  return job;
}

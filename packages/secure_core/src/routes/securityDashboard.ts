/**
 * Operator security dashboard route.
 *
 * First construction slice for the admin/security dashboard: exposes
 * chain health, anchor lag, denied-access spikes, and sandbox-violation
 * counters behind operator audit-read capability and step-up auth.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import { withOperatorStepUp } from "../middleware/operatorStepUp.js";
import type { SecurityDashboardReader } from "../security/dashboard.js";
import { SecureCoreError } from "../errors/shapes.js";
import type { AuditLogger } from "../audit/logger.js";

export interface SecurityDashboardRoutesMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
  /** Pre-bound to `platform:audit_read`. */
  readonly requireOperatorAuditRead: NamedMiddleware;
}

export interface SecurityDashboardRoutesOptions {
  readonly service: SecurityDashboardReader;
  readonly auditLogger: AuditLogger;
  readonly mw: SecurityDashboardRoutesMiddleware;
}

const CHAIN_HEALTH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "logType",
    "ok",
    "rowsVerified",
    "tipHash",
    "latestAnchorCommittedAt",
    "latestExternalAnchorUri",
    "anchorLagMs",
    "status",
  ],
  properties: {
    logType: { type: "string", enum: ["audit", "provenance", "operator"] },
    ok: { type: "boolean" },
    rowsVerified: { type: "integer", minimum: 0 },
    tipHash: { anyOf: [{ type: "string" }, { type: "null" }] },
    failureReason: { type: "string" },
    latestAnchorCommittedAt: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    latestExternalAnchorUri: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    anchorLagMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    status: { type: "string", enum: ["healthy", "warning", "critical"] },
  },
} as const;

const COUNTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "count", "windowMs", "status"],
  properties: {
    name: { type: "string" },
    count: { type: "integer", minimum: 0 },
    windowMs: { type: "integer", minimum: 1 },
    status: { type: "string", enum: ["healthy", "warning", "critical"] },
  },
} as const;

export const SECURITY_DASHBOARD_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "generatedAt",
    "status",
    "chains",
    "deniedAccess",
    "sandboxViolations",
  ],
  properties: {
    generatedAt: { type: "string" },
    status: { type: "string", enum: ["healthy", "warning", "critical"] },
    chains: { type: "array", items: CHAIN_HEALTH_SCHEMA },
    deniedAccess: { type: "array", items: COUNTER_SCHEMA },
    sandboxViolations: { type: "array", items: COUNTER_SCHEMA },
  },
} as const;

export const securityDashboardRoutes:
  FastifyPluginAsync<SecurityDashboardRoutesOptions> = async (
    app: FastifyInstance,
    opts,
  ) => {
    const requireOperatorAuditRead = withOperatorStepUp({
      middleware: opts.mw.requireOperatorAuditRead,
      capability: "platform:audit_read",
      auditLogger: opts.auditLogger,
      message: "Operator dashboard requires step-up authentication.",
    });

    app.get(
      "/operator/security-dashboard",
      {
        schema: { response: { 200: SECURITY_DASHBOARD_RESPONSE_SCHEMA } },
        preHandler: composeMiddleware([
          opts.mw.requireAuth,
          opts.mw.attachAuditActor,
          requireOperatorAuditRead,
        ]),
      },
      async (req) => {
        if (req.auth === undefined) {
          throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
        }
        return opts.service.getSecurityDashboard();
      },
    );
  };

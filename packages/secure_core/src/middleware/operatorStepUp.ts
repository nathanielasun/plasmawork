/**
 * Operator step-up decorator.
 *
 * Operator routes use platform capability middleware in the
 * `requireCapability` slot. Step-up auth belongs in that same slot:
 * it must run after server-derived auth/audit actor attachment, but
 * before L2.9 consumes any high-risk approval token.
 */

import type { FastifyRequest } from "fastify";

import type { AuditLogger } from "../audit/logger.js";
import type { Capability } from "../config/capabilities.js";
import { PermissionDeniedError } from "../errors/shapes.js";
import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";

export interface WithOperatorStepUpOptions {
  readonly middleware: NamedMiddleware;
  readonly capability: Capability;
  readonly auditLogger: AuditLogger;
  readonly message: string;
}

function hasStepUp(req: FastifyRequest): boolean {
  return (
    req.auth?.assuranceLevel === "aal2" ||
    req.auth?.assuranceLevel === "aal3"
  );
}

async function auditStepUpDenied(
  req: FastifyRequest,
  auditLogger: AuditLogger,
  capability: Capability,
): Promise<void> {
  const actorType = req.audit?.actorType ?? req.auth?.actorType ?? "unauthenticated";
  const actorUserId =
    actorType === "unauthenticated"
      ? null
      : (req.audit?.actorUserId ?? req.auth?.userId ?? null);

  await auditLogger.write({
    workspaceId: null,
    actorUserId,
    actorType,
    action: "permission.denied",
    result: "denied",
    requestId: req.requestId,
    metadata: {
      denied_reason: "step_up_required",
      capability,
    },
  });
}

export function withOperatorStepUp(
  opts: WithOperatorStepUpOptions,
): NamedMiddleware {
  if (opts.middleware.name !== "requireCapability") {
    throw new Error(
      `withOperatorStepUp requires a requireCapability middleware; got ${opts.middleware.name}`,
    );
  }

  const handler: MiddlewareHandler = async (req, reply) => {
    await opts.middleware.handler(req, reply);
    if (hasStepUp(req)) {
      return;
    }
    await auditStepUpDenied(req, opts.auditLogger, opts.capability);
    throw new PermissionDeniedError(opts.message, {
      reason: "step_up_required",
    });
  };

  return { name: "requireCapability", handler };
}

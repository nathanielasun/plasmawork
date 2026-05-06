/**
 * `requireCapability` — Phase 0.5 Layer 2.
 *
 * Per v4 §13 + ADR-0008, every privileged route gates on a capability
 * (e.g. `capsule:update`) rather than a role name. This middleware
 * checks `req.membership.capabilities` for the configured capability,
 * passes through on hit, and emits a `permission.denied` audit + throws
 * `PERMISSION_DENIED` on miss.
 *
 * Composition contract: this middleware MUST run after
 * `requireWorkspaceMembership` per the §6.2 order encoded in
 * `compose.ts`. If `req.membership` is unset at call time, the route
 * was wired wrong (a programmer error, not a user-facing one) and the
 * middleware throws a plain `Error` so the misconfiguration surfaces in
 * logs rather than as a misleading 403.
 *
 * Capability typo guard: the factory validates the requested capability
 * against `CAPABILITY_SET` at registration time. A typo at the route
 * (`capsule:reed`) fails route registration loudly rather than silently
 * never matching at runtime.
 */

import type { FastifyRequest, FastifyReply } from "fastify";

import { PermissionDeniedError } from "../errors/shapes.js";
import {
  type Capability,
  CAPABILITY_SET,
} from "../config/capabilities.js";
import type { AuditLogger } from "../audit/logger.js";
import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";

export interface RequireCapabilityDeps {
  readonly capability: Capability;
  readonly auditLogger: AuditLogger;
}

/**
 * Build the §6.2-step capability check. The `capability` must be a
 * literal from `CAPABILITIES`; an unknown value throws synchronously
 * so a route registration like:
 *
 *     composeMiddleware([requireCapability({ capability: "capsule:reed", ... })])
 *
 * fails at boot, not on the first denied request.
 */
export function requireCapability(
  deps: RequireCapabilityDeps,
): NamedMiddleware {
  if (!CAPABILITY_SET.has(deps.capability)) {
    throw new Error(
      `requireCapability: unknown capability "${String(deps.capability)}". ` +
        `Capabilities must come from src/config/capabilities.ts.`,
    );
  }

  const handler: MiddlewareHandler = async (
    req: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> => {
    const membership = req.membership;
    if (membership === undefined) {
      // Programmer error — the route was composed without
      // `requireWorkspaceMembership` upstream. This must NOT surface as a
      // user-facing 403; the misconfiguration deserves a 500 + log line.
      throw new Error(
        "requireCapability: req.membership is unset. " +
          "Compose requireWorkspaceMembership before requireCapability per §6.2.",
      );
    }

    if (membership.capabilities.has(deps.capability)) {
      return;
    }

    // Denied path — emit `permission.denied` then throw the typed error.
    // Actor-type defaults to `human` because §6.2 already ran
    // `attachAuditActor`; if it is somehow missing, fall back to the
    // most common actor shape so the audit row still emits.
    const audit = req.audit;
    const actorType = audit?.actorType ?? "human";
    const actorUserId =
      actorType === "unauthenticated" ? null : audit?.actorUserId ?? null;
    await deps.auditLogger.write({
      workspaceId: req.workspace?.id ?? null,
      actorUserId,
      actorType,
      action: "permission.denied",
      result: "denied",
      requestId: req.requestId,
      metadata: {
        capability: deps.capability,
        role_name: membership.roleName,
      },
    });

    throw new PermissionDeniedError("Capability not granted.", {
      capability: deps.capability,
    });
  };

  return { name: "requireCapability", handler };
}

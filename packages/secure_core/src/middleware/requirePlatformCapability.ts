/**
 * Platform capability middleware.
 *
 * Operator routes are intentionally not workspace-scoped. This check
 * therefore verifies a server-authenticated user holds the requested
 * platform capability through any active role assignment, without
 * reading workspace ids or privilege claims from the request body.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";

import {
  CAPABILITY_SET,
  type Capability,
} from "../config/capabilities.js";
import {
  rolePermissions,
  workspaceMemberships,
  workspaces,
} from "../db/schema.js";
import type { SecureCorePool } from "../db/pool.js";
import type { AuditLogger } from "../audit/logger.js";
import { PermissionDeniedError, SecureCoreError } from "../errors/shapes.js";
import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";

export interface RequirePlatformCapabilityDeps {
  readonly capability: Capability;
  readonly pool: SecureCorePool;
  readonly auditLogger: AuditLogger;
}

async function hasActivePlatformCapability(
  pool: SecureCorePool,
  userId: string,
  capability: Capability,
): Promise<boolean> {
  const rows = await pool.db
    .select({ capability: rolePermissions.capability })
    .from(workspaceMemberships)
    .innerJoin(
      rolePermissions,
      eq(rolePermissions.roleId, workspaceMemberships.roleId),
    )
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .where(
      and(
        eq(workspaceMemberships.userId, userId),
        isNull(workspaceMemberships.removedAt),
        isNull(workspaces.deletedAt),
        eq(rolePermissions.capability, capability),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export function requirePlatformCapability(
  deps: RequirePlatformCapabilityDeps,
): NamedMiddleware {
  if (!CAPABILITY_SET.has(deps.capability)) {
    throw new Error(
      `requirePlatformCapability: unknown capability "${String(
        deps.capability,
      )}". Capabilities must come from src/config/capabilities.ts.`,
    );
  }
  if (!deps.capability.startsWith("platform:")) {
    throw new Error(
      `requirePlatformCapability: "${deps.capability}" is not a platform capability.`,
    );
  }

  const handler: MiddlewareHandler = async (
    req: FastifyRequest,
  ): Promise<void> => {
    if (req.auth === undefined) {
      throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
    }

    const allowed = await hasActivePlatformCapability(
      deps.pool,
      req.auth.userId,
      deps.capability,
    );
    if (allowed) {
      return;
    }

    const audit = req.audit;
    const actorType = audit?.actorType ?? req.auth.actorType;
    const actorUserId =
      actorType === "unauthenticated"
        ? null
        : (audit?.actorUserId ?? req.auth.userId);

    await deps.auditLogger.write({
      workspaceId: null,
      actorUserId,
      actorType,
      action: "permission.denied",
      result: "denied",
      requestId: req.requestId,
      metadata: {
        capability: deps.capability,
        role_name: "platform",
      },
    });

    throw new PermissionDeniedError("Platform capability not granted.", {
      capability: deps.capability,
    });
  };

  return { name: "requireCapability", handler };
}

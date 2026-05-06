/**
 * `requireWorkspaceMembership` — Phase 0.5 Layer 2 / L2.5.
 *
 * After `loadWorkspace` confirms the workspace exists and is not
 * soft-deleted, this middleware confirms the authenticated caller is a
 * current member (no `removed_at`) and resolves their role + capability
 * set in one query. Per v4 §5.2 + §6 the membership lookup is
 * mandatory before any authorization decision; per v4 §4.4 the
 * non-member case collapses into the same uniform 404 as a missing
 * workspace — no distinguishing message, no capability hint.
 *
 * Programmer-error vs. caller-error split:
 *
 *   - `req.auth` and `req.workspace` MUST be set by upstream
 *     middleware (`requireAuth` and `loadWorkspace`). If either is
 *     missing, the route was composed incorrectly. We throw a plain
 *     `Error` so the §3 mapper turns it into `INTERNAL_ERROR` and an
 *     audit trail captures the misconfiguration. `composeMiddleware`
 *     enforces the §6.2 ordering at registration time, so this should
 *     never fire in production.
 *
 *   - Non-member, removed-member, role-without-capabilities all collapse
 *     into `NotFoundError` (uniform 404 per §4.4).
 *
 * The join (`workspace_memberships → roles → role_permissions`) returns
 * one row per capability for the caller's active membership. We collapse
 * the rows into a `ReadonlySet<Capability>` and attach the result to
 * `req.membership` for `requireCapability` to consume downstream.
 */

import type { FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";

import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";
import type { MembershipContext } from "./types.js";
import { NotFoundError } from "../errors/shapes.js";
import {
  rolePermissions,
  roles,
  workspaceMemberships,
} from "../db/schema.js";
import type { SecureCorePool } from "../db/pool.js";
import {
  isCapability,
  type Capability,
} from "../config/capabilities.js";

export interface RequireMembershipDeps {
  readonly pool: SecureCorePool;
}

const UNIFORM_NOT_FOUND_MESSAGE = "Not found.";

interface MembershipJoinRow {
  roleId: string;
  roleName: string;
  capability: string | null;
}

async function loadMembershipJoin(
  pool: SecureCorePool,
  workspaceId: string,
  userId: string,
): Promise<MembershipJoinRow[]> {
  return pool.db
    .select({
      roleId: workspaceMemberships.roleId,
      roleName: roles.name,
      capability: rolePermissions.capability,
    })
    .from(workspaceMemberships)
    .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
    .leftJoin(
      rolePermissions,
      eq(rolePermissions.roleId, workspaceMemberships.roleId),
    )
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, userId),
        isNull(workspaceMemberships.removedAt),
      ),
    );
}

export function requireWorkspaceMembership(
  deps: RequireMembershipDeps,
): NamedMiddleware {
  const { pool } = deps;

  const handler: MiddlewareHandler = async (
    req: FastifyRequest,
  ): Promise<void> => {
    if (!req.auth) {
      // Programmer error: requireAuth did not run. composeMiddleware
      // enforces ordering at registration; reaching this branch means
      // the route bypassed compose entirely.
      throw new Error(
        "requireWorkspaceMembership: req.auth is missing. " +
          "Compose this middleware after requireAuth.",
      );
    }
    if (!req.workspace) {
      throw new Error(
        "requireWorkspaceMembership: req.workspace is missing. " +
          "Compose this middleware after loadWorkspace.",
      );
    }

    const workspaceId = req.workspace.id;
    const userId = req.auth.userId;

    const rows = await loadMembershipJoin(pool, workspaceId, userId);

    if (rows.length === 0) {
      // §4.4: non-member collapses to uniform 404. No audit emission
      // here — `requireCapability` is the layer that emits
      // `permission.denied` for a member without the right capability.
      // A non-member never reaches that layer; the workspace is simply
      // "not found" to them.
      throw new NotFoundError(UNIFORM_NOT_FOUND_MESSAGE);
    }

    const first = rows[0];
    const capabilities = new Set<Capability>();
    for (const row of rows) {
      if (row.capability !== null && isCapability(row.capability)) {
        capabilities.add(row.capability);
      }
      // Capabilities present in `role_permissions` but not in the
      // `Capability` literal-union are silently dropped. The §13 seed
      // migration is the source of truth; lint forbids strings outside
      // `src/config/`. A drift here is an audit-time finding, not a
      // request-time refusal.
    }

    const membership: MembershipContext = {
      workspaceId,
      userId,
      roleId: first.roleId,
      roleName: first.roleName,
      capabilities,
    };
    req.membership = membership;
  };

  return { name: "requireWorkspaceMembership", handler };
}

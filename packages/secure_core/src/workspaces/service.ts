/**
 * Workspace + membership service — Phase 0.5 Layer 4 task L4.1.
 *
 * Backs the v4 §10.2 workspace endpoints:
 *
 *   GET    /workspaces                                    listForActor
 *   POST   /workspaces                                    createWorkspace
 *   GET    /workspaces/:workspaceId/members               listMembers
 *   POST   /workspaces/:workspaceId/members               addMember
 *   PATCH  /workspaces/:workspaceId/members/:userId       changeMemberRole
 *   DELETE /workspaces/:workspaceId/members/:userId       removeMember
 *
 * All mutations are atomic conditional UPDATEs / INSERTs (no
 * read-then-modify outside a tx). Membership changes log an
 * `workspace_membership_events` row alongside the data change so the
 * cross-cutting v4 §29 #59-#60 invariants ("removing a member
 * immediately blocks future requests" + "rejoining a removed member
 * is allowed and replaces the old row") are audit-visible.
 *
 * The service NEVER reads `actor_user_id` from anywhere except the
 * caller's `actorUserId` argument (which the route handler derives
 * from `req.auth.userId` per v4 §19.1).
 */

import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";

import type { SecureCorePool } from "../db/pool.js";
import {
  workspaces,
  workspaceMemberships,
} from "../db/schema.js";
import type { AuditLogger } from "../audit/logger.js";
import {
  NotFoundError,
  PermissionDeniedError,
  SecureCoreError,
} from "../errors/shapes.js";

export interface WorkspaceRow {
  id: string;
  name: string;
  created_by: string;
  created_at: Date;
}

export interface MembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role_id: string;
  role_name: string;
  created_at: Date;
}

export interface WorkspaceServiceOptions {
  readonly pool: SecureCorePool;
  readonly auditLogger: AuditLogger;
  /**
   * The seeded role name granted to the workspace creator. Defaults
   * to `"WorkspaceAdmin"` per v4 §13. Tests can override.
   */
  readonly creatorRoleName?: string;
}

export interface CreateWorkspaceOptions {
  readonly name: string;
  readonly createdByUserId: string;
  readonly requestId: string;
}

export interface AddMemberOptions {
  readonly workspaceId: string;
  readonly targetUserId: string;
  readonly roleName: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface ChangeMemberRoleOptions {
  readonly workspaceId: string;
  readonly targetUserId: string;
  readonly newRoleName: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export interface RemoveMemberOptions {
  readonly workspaceId: string;
  readonly targetUserId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export class WorkspaceService {
  readonly #pool: SecureCorePool;
  readonly #auditLogger: AuditLogger;
  readonly #creatorRoleName: string;

  public constructor(opts: WorkspaceServiceOptions) {
    this.#pool = opts.pool;
    this.#auditLogger = opts.auditLogger;
    this.#creatorRoleName = opts.creatorRoleName ?? "WorkspaceAdmin";
  }

  async #assertCanManageMembersAtCommit(
    sql: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ): Promise<void> {
    const rows = await sql<{ ok: number }[]>`
      SELECT 1 AS ok
      FROM workspace_memberships m
      JOIN role_permissions rp ON rp.role_id = m.role_id
      WHERE m.workspace_id = ${workspaceId}
        AND m.user_id = ${actorUserId}
        AND m.removed_at IS NULL
        AND rp.capability = 'workspace:manage_members'
      LIMIT 1
    `;
    if (rows.length === 0) {
      throw new PermissionDeniedError(
        "Workspace membership changed before commit.",
        { capability: "workspace:manage_members" },
      );
    }
  }

  /**
   * Create a workspace + add the creator as a `WorkspaceAdmin` in a
   * single tx. Audit: `workspace.created` + `workspace.member_added`.
   */
  public async createWorkspace(
    opts: CreateWorkspaceOptions,
  ): Promise<WorkspaceRow> {
    if (typeof opts.name !== "string" || opts.name.trim().length === 0) {
      throw new SecureCoreError("INPUT_INVALID", "Workspace name is required.");
    }
    if (opts.name.length > 200) {
      throw new SecureCoreError("INPUT_INVALID", "Workspace name too long.");
    }

    const sqlClient = this.#pool.sql;
    const id = randomUUID();
    const created: WorkspaceRow = await sqlClient.begin(async (tx) => {
      const wsRows = await tx<
        Array<{ id: string; name: string; created_by: string; created_at: Date }>
      >`
        INSERT INTO workspaces (id, name, created_by)
        VALUES (${id}, ${opts.name}, ${opts.createdByUserId})
        RETURNING id, name, created_by, created_at
      `;
      const ws = wsRows[0];

      // Resolve role id by the seeded name. The creator-admin role
      // MUST exist (seeded in migration 0002).
      const roleRows = await tx<{ id: string }[]>`
        SELECT id FROM roles WHERE name = ${this.#creatorRoleName}
      `;
      if (roleRows.length === 0) {
        throw new SecureCoreError(
          "INTERNAL_ERROR",
          `Creator role "${this.#creatorRoleName}" not seeded.`,
        );
      }
      const roleId = roleRows[0].id;

      const membershipId = randomUUID();
      await tx`
        INSERT INTO workspace_memberships
          (id, workspace_id, user_id, role_id, created_by)
        VALUES (${membershipId}, ${ws.id}, ${opts.createdByUserId},
                ${roleId}, ${opts.createdByUserId})
      `;
      await tx`
        INSERT INTO workspace_membership_events
          (id, workspace_id, target_user_id, actor_user_id, event_type,
           old_role_id, new_role_id)
        VALUES (${randomUUID()}, ${ws.id}, ${opts.createdByUserId},
                ${opts.createdByUserId}, 'added', NULL, ${roleId})
      `;
      return ws;
    });

    await this.#auditLogger.write({
      workspaceId: created.id,
      actorUserId: opts.createdByUserId,
      actorType: "human",
      action: "workspace.created",
      result: "succeeded",
      objectType: "workspace",
      objectId: created.id,
      requestId: opts.requestId,
    });
    await this.#auditLogger.write({
      workspaceId: created.id,
      actorUserId: opts.createdByUserId,
      actorType: "human",
      action: "workspace.member_added",
      result: "succeeded",
      objectType: "workspace",
      objectId: created.id,
      requestId: opts.requestId,
      metadata: { target_user_id_redacted: hashId(opts.createdByUserId) },
    });
    return created;
  }

  /**
   * List workspaces the user is a current (non-removed) member of.
   * The deleted_at filter pins v4 §27 — soft-deleted workspaces
   * disappear from the list immediately.
   */
  public async listForActor(
    actorUserId: string,
  ): Promise<readonly WorkspaceRow[]> {
    const drizzle = this.#pool.db;
    const rows = await drizzle
      .select({
        id: workspaces.id,
        name: workspaces.name,
        created_by: workspaces.createdBy,
        created_at: workspaces.createdAt,
      })
      .from(workspaces)
      .innerJoin(
        workspaceMemberships,
        eq(workspaceMemberships.workspaceId, workspaces.id),
      )
      .where(
        and(
          eq(workspaceMemberships.userId, actorUserId),
          isNull(workspaceMemberships.removedAt),
          isNull(workspaces.deletedAt),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      created_by: r.created_by,
      created_at: r.created_at,
    }));
  }

  public async listMembers(
    workspaceId: string,
  ): Promise<readonly MembershipRow[]> {
    const sqlClient = this.#pool.sql;
    const rows = await sqlClient<
      Array<{
        id: string;
        workspace_id: string;
        user_id: string;
        role_id: string;
        role_name: string;
        created_at: Date;
      }>
    >`
      SELECT m.id, m.workspace_id, m.user_id, m.role_id,
             r.name AS role_name, m.created_at
      FROM workspace_memberships m
      JOIN roles r ON r.id = m.role_id
      WHERE m.workspace_id = ${workspaceId}
        AND m.removed_at IS NULL
      ORDER BY m.created_at ASC
    `;
    return rows;
  }

  /**
   * Add a member to a workspace. Idempotent: if a (non-removed) row
   * already exists for the same user, returns the existing row
   * without creating a new one. If a previously-removed row exists,
   * inserts a fresh row (the partial unique index allows this per
   * v4 §29 #60).
   */
  public async addMember(opts: AddMemberOptions): Promise<MembershipRow> {
    if (opts.actorUserId === opts.targetUserId) {
      throw new SecureCoreError(
        "INPUT_INVALID",
        "Use createWorkspace to add the workspace creator.",
      );
    }
    const sqlClient = this.#pool.sql;
    return await sqlClient.begin(async (tx) => {
      await this.#assertCanManageMembersAtCommit(
        tx,
        opts.workspaceId,
        opts.actorUserId,
      );
      // Resolve target role id.
      const roleRows = await tx<{ id: string }[]>`
        SELECT id FROM roles WHERE name = ${opts.roleName}
      `;
      if (roleRows.length === 0) {
        throw new SecureCoreError(
          "INPUT_INVALID",
          `Role "${opts.roleName}" not found.`,
        );
      }
      const roleId = roleRows[0].id;

      // Idempotency: existing active membership returns as-is.
      const existing = await tx<
        Array<{
          id: string;
          workspace_id: string;
          user_id: string;
          role_id: string;
          role_name: string;
          created_at: Date;
        }>
      >`
        SELECT m.id, m.workspace_id, m.user_id, m.role_id,
               r.name AS role_name, m.created_at
        FROM workspace_memberships m
        JOIN roles r ON r.id = m.role_id
        WHERE m.workspace_id = ${opts.workspaceId}
          AND m.user_id = ${opts.targetUserId}
          AND m.removed_at IS NULL
        LIMIT 1
      `;
      if (existing.length > 0) {
        return existing[0];
      }

      const membershipId = randomUUID();
      const inserted = await tx<
        Array<{
          id: string;
          workspace_id: string;
          user_id: string;
          role_id: string;
          created_at: Date;
        }>
      >`
        INSERT INTO workspace_memberships
          (id, workspace_id, user_id, role_id, created_by)
        VALUES (${membershipId}, ${opts.workspaceId}, ${opts.targetUserId},
                ${roleId}, ${opts.actorUserId})
        RETURNING id, workspace_id, user_id, role_id, created_at
      `;
      await tx`
        INSERT INTO workspace_membership_events
          (id, workspace_id, target_user_id, actor_user_id, event_type,
           old_role_id, new_role_id)
        VALUES (${randomUUID()}, ${opts.workspaceId}, ${opts.targetUserId},
                ${opts.actorUserId}, 'added', NULL, ${roleId})
      `;
      const row = inserted[0];
      await this.#auditLogger.write({
        workspaceId: opts.workspaceId,
        actorUserId: opts.actorUserId,
        actorType: "human",
        action: "workspace.member_added",
        result: "succeeded",
        objectType: "workspace",
        objectId: opts.workspaceId,
        requestId: opts.requestId,
        metadata: { target_user_id_redacted: hashId(opts.targetUserId) },
      });
      return {
        ...row,
        role_name: opts.roleName,
      };
    });
  }

  /**
   * Atomically swap a member's role. v4 §29 #59 invariant: the change
   * MUST be effective before the next request from that user is
   * processed — the conditional UPDATE on `removed_at IS NULL` plus
   * the partial unique index guarantee no in-flight request can
   * race past the membership row.
   */
  public async changeMemberRole(
    opts: ChangeMemberRoleOptions,
  ): Promise<MembershipRow> {
    const sqlClient = this.#pool.sql;
    return await sqlClient.begin(async (tx) => {
      await this.#assertCanManageMembersAtCommit(
        tx,
        opts.workspaceId,
        opts.actorUserId,
      );
      const roleRows = await tx<{ id: string }[]>`
        SELECT id FROM roles WHERE name = ${opts.newRoleName}
      `;
      if (roleRows.length === 0) {
        throw new SecureCoreError(
          "INPUT_INVALID",
          `Role "${opts.newRoleName}" not found.`,
        );
      }
      const newRoleId = roleRows[0].id;

      const updated = await tx<
        Array<{
          id: string;
          workspace_id: string;
          user_id: string;
          role_id: string;
          created_at: Date;
          old_role_id: string;
        }>
      >`
        UPDATE workspace_memberships
        SET role_id = ${newRoleId}
        FROM (
          SELECT role_id AS old_role_id
          FROM workspace_memberships
          WHERE workspace_id = ${opts.workspaceId}
            AND user_id = ${opts.targetUserId}
            AND removed_at IS NULL
        ) AS prev
        WHERE workspace_memberships.workspace_id = ${opts.workspaceId}
          AND workspace_memberships.user_id = ${opts.targetUserId}
          AND workspace_memberships.removed_at IS NULL
        RETURNING workspace_memberships.id, workspace_memberships.workspace_id,
                  workspace_memberships.user_id, workspace_memberships.role_id,
                  workspace_memberships.created_at,
                  prev.old_role_id
      `;
      if (updated.length === 0) {
        throw new NotFoundError("Member not found.", {
          workspace_id: opts.workspaceId,
          user_id_redacted: hashId(opts.targetUserId),
        });
      }
      const row = updated[0];
      await tx`
        INSERT INTO workspace_membership_events
          (id, workspace_id, target_user_id, actor_user_id, event_type,
           old_role_id, new_role_id)
        VALUES (${randomUUID()}, ${opts.workspaceId}, ${opts.targetUserId},
                ${opts.actorUserId}, 'role_changed',
                ${row.old_role_id}, ${newRoleId})
      `;
      await this.#auditLogger.write({
        workspaceId: opts.workspaceId,
        actorUserId: opts.actorUserId,
        actorType: "human",
        action: "workspace.role_changed",
        result: "succeeded",
        objectType: "workspace",
        objectId: opts.workspaceId,
        requestId: opts.requestId,
        metadata: { target_user_id_redacted: hashId(opts.targetUserId) },
      });
      return {
        id: row.id,
        workspace_id: row.workspace_id,
        user_id: row.user_id,
        role_id: row.role_id,
        role_name: opts.newRoleName,
        created_at: row.created_at,
      };
    });
  }

  /**
   * Remove a member by setting `removed_at`. v4 §29 #59: the change
   * MUST be effective before the next request — the conditional
   * UPDATE either flips an active row or returns 0 rows.
   *
   * The original creator can be removed (e.g. ownership handoff);
   * v4 doesn't carve them out. Callers enforce policy upstream if
   * needed.
   */
  public async removeMember(opts: RemoveMemberOptions): Promise<void> {
    const sqlClient = this.#pool.sql;
    await sqlClient.begin(async (tx) => {
      await this.#assertCanManageMembersAtCommit(
        tx,
        opts.workspaceId,
        opts.actorUserId,
      );
      const updated = await tx<{ role_id: string }[]>`
        UPDATE workspace_memberships
        SET removed_at = now()
        WHERE workspace_id = ${opts.workspaceId}
          AND user_id = ${opts.targetUserId}
          AND removed_at IS NULL
        RETURNING role_id
      `;
      if (updated.length === 0) {
        throw new NotFoundError("Member not found.", {
          workspace_id: opts.workspaceId,
          user_id_redacted: hashId(opts.targetUserId),
        });
      }
      await tx`
        INSERT INTO workspace_membership_events
          (id, workspace_id, target_user_id, actor_user_id, event_type,
           old_role_id, new_role_id)
        VALUES (${randomUUID()}, ${opts.workspaceId}, ${opts.targetUserId},
                ${opts.actorUserId}, 'removed', ${updated[0].role_id}, NULL)
      `;
    });
    await this.#auditLogger.write({
      workspaceId: opts.workspaceId,
      actorUserId: opts.actorUserId,
      actorType: "human",
      action: "workspace.member_removed",
      result: "succeeded",
      objectType: "workspace",
      objectId: opts.workspaceId,
      requestId: opts.requestId,
      metadata: { target_user_id_redacted: hashId(opts.targetUserId) },
    });
  }
}

/** Stable redaction hash for user ids surfaced in audit metadata. */
function hashId(userId: string): string {
  // SHA-256 prefix (12 hex chars) — non-reversible but stable so
  // operators correlating audit rows for the same target user can
  // do so without seeing the raw uuid.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

/**
 * Bootstrap DB adapter — Phase 0.5 auth gateway / Phase B (2026-05-09).
 *
 * Implements the `BootstrapDbAdapter` seam from
 * `secure_core/src/bootstrap/service.ts`. The single multi-row tx
 * BootstrapService demands runs end-to-end here:
 *
 *   1. INSERT into `users` (username; email = NULL — the seeded root
 *      admin has no email of record).
 *   2. INSERT into `user_credentials` with the Argon2id hash.
 *   3. INSERT 3 seeded workspaces:
 *        - `_platform` (synthetic — only the admin is a member; gives
 *          them the IncidentRemediator role, which carries every
 *          `platform:*` capability + `session:revoke` + `user:disable`).
 *        - `shared-internal-tools` (admin is WorkspaceAdmin; ordinary
 *          users get `Viewer` or `ModuleDeveloper` per the org's
 *          policy).
 *        - `shared-public-experiments` (admin is WorkspaceAdmin;
 *          ordinary users get `Researcher` so they can fork into
 *          their private workspaces).
 *   4. INSERT 3 workspace_memberships tying the admin to each.
 *
 * Role IDs are taken from the already-seeded `roles` table:
 *   - WorkspaceAdmin: 5b807f69-df63-5054-a96a-490c9668a567
 *   - IncidentRemediator: 9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad
 *
 * No new role needed: IncidentRemediator already carries all five
 * platform capabilities the root admin requires for ongoing user-
 * management work.
 *
 * The `_platform` workspace is special — it exists ONLY so
 * `requirePlatformCapability` can find a matching role assignment via
 * its workspace-membership join. No data lives there. Future code
 * paths that enumerate "all workspaces a user can see" MUST exclude
 * the `_platform` slug (callers should filter by name or by a
 * deny-list).
 */

import { randomUUID } from "node:crypto";

import type { BootstrapDbAdapter } from "../../../../packages/secure_core/src/bootstrap/service.js";
import type { SecureCorePool } from "../../../../packages/secure_core/src/db/pool.js";

import { hashPassword } from "../auth/argon2Adapter.js";

/**
 * Deterministic role ids from `0002_seed_capabilities.sql`. Imported
 * as constants so a typo here is a compile error rather than a
 * silent assignment to the wrong role.
 */
const ROLE_ID_WORKSPACE_ADMIN = "5b807f69-df63-5054-a96a-490c9668a567";
const ROLE_ID_INCIDENT_REMEDIATOR = "9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad";

/**
 * Fixed names for the seeded workspaces. Every workspace name is also
 * its slug — the gateway's URL mapping uses the name verbatim.
 */
export const SEEDED_PLATFORM_WORKSPACE_NAME = "_platform";
export const SEEDED_INTERNAL_TOOLS_WORKSPACE_NAME = "shared-internal-tools";
export const SEEDED_PUBLIC_EXPERIMENTS_WORKSPACE_NAME =
  "shared-public-experiments";

export const SEEDED_WORKSPACE_NAMES = Object.freeze([
  SEEDED_PLATFORM_WORKSPACE_NAME,
  SEEDED_INTERNAL_TOOLS_WORKSPACE_NAME,
  SEEDED_PUBLIC_EXPERIMENTS_WORKSPACE_NAME,
] as const);

export interface BootstrapDbAdapterDeps {
  readonly pool: SecureCorePool;
  /**
   * Override for tests. Defaults to the real `hashPassword` from
   * `argon2Adapter.ts`. Tests inject a fast no-op so the bootstrap
   * tx isn't gated on a 64 MiB Argon2 round.
   */
  readonly hashPasswordFn?: (plaintext: string) => Promise<string>;
  /** Override for tests. Defaults to crypto.randomUUID. */
  readonly generateId?: () => string;
}

export function createBootstrapDbAdapter(
  deps: BootstrapDbAdapterDeps,
): BootstrapDbAdapter {
  const { pool } = deps;
  const hashFn = deps.hashPasswordFn ?? hashPassword;
  const generateId = deps.generateId ?? randomUUID;

  return {
    async platformAdminExists(): Promise<boolean> {
      // A platform admin is any user with a non-removed membership in
      // any workspace whose role grants `platform:incident_remediate`.
      // We use that capability specifically because it's the highest
      // platform privilege — denying re-bootstrap there matches the
      // intent of "a platform admin already exists".
      const rows = await pool.sql<Array<{ exists_flag: number }>>`
        SELECT 1 AS exists_flag
        FROM workspace_memberships m
        JOIN role_permissions rp ON rp.role_id = m.role_id
        JOIN users u ON u.id = m.user_id
        WHERE m.removed_at IS NULL
          AND u.disabled_at IS NULL
          AND rp.capability = 'platform:incident_remediate'
        LIMIT 1
      `;
      return rows.length > 0;
    },

    async insertPlatformAdmin(opts: {
      readonly username: string;
      readonly password: string;
      readonly requestId: string;
    }): Promise<{ readonly adminUserId: string }> {
      const adminUserId = generateId();
      const platformWsId = generateId();
      const internalToolsWsId = generateId();
      const publicExperimentsWsId = generateId();
      const passwordHash = await hashFn(opts.password);

      await pool.sql.begin(async (tx) => {
        // 1. User row (no email; username only).
        await tx`
          INSERT INTO users (id, username, email, display_name)
          VALUES (
            ${adminUserId},
            ${opts.username},
            NULL,
            'Root Admin'
          )
        `;

        // 2. Argon2id credential.
        await tx`
          INSERT INTO user_credentials (user_id, password_hash, algorithm)
          VALUES (
            ${adminUserId},
            ${passwordHash},
            'argon2id'
          )
        `;

        // 3. Seeded workspaces. created_by points at the admin we just
        // inserted — the FK is satisfied because we're inside the same
        // tx and the user row landed first.
        await tx`
          INSERT INTO workspaces (id, name, created_by)
          VALUES
            (${platformWsId}, ${SEEDED_PLATFORM_WORKSPACE_NAME}, ${adminUserId}),
            (${internalToolsWsId}, ${SEEDED_INTERNAL_TOOLS_WORKSPACE_NAME}, ${adminUserId}),
            (${publicExperimentsWsId}, ${SEEDED_PUBLIC_EXPERIMENTS_WORKSPACE_NAME}, ${adminUserId})
        `;

        // 4. Memberships:
        //   - _platform → IncidentRemediator (platform capabilities)
        //   - shared-internal-tools → WorkspaceAdmin
        //   - shared-public-experiments → WorkspaceAdmin
        const platformMembershipId = generateId();
        const internalToolsMembershipId = generateId();
        const publicExperimentsMembershipId = generateId();
        await tx`
          INSERT INTO workspace_memberships
            (id, workspace_id, user_id, role_id, created_by)
          VALUES
            (${platformMembershipId}, ${platformWsId}, ${adminUserId},
             ${ROLE_ID_INCIDENT_REMEDIATOR}, ${adminUserId}),
            (${internalToolsMembershipId}, ${internalToolsWsId}, ${adminUserId},
             ${ROLE_ID_WORKSPACE_ADMIN}, ${adminUserId}),
            (${publicExperimentsMembershipId}, ${publicExperimentsWsId},
             ${adminUserId}, ${ROLE_ID_WORKSPACE_ADMIN}, ${adminUserId})
        `;

        // Membership-event rows mirror the audit-table convention: a
        // companion row for every membership change so the membership
        // history is queryable independent of the audit chain.
        await tx`
          INSERT INTO workspace_membership_events
            (id, workspace_id, target_user_id, actor_user_id, event_type, new_role_id)
          VALUES
            (${generateId()}, ${platformWsId}, ${adminUserId}, ${adminUserId},
             'added', ${ROLE_ID_INCIDENT_REMEDIATOR}),
            (${generateId()}, ${internalToolsWsId}, ${adminUserId}, ${adminUserId},
             'added', ${ROLE_ID_WORKSPACE_ADMIN}),
            (${generateId()}, ${publicExperimentsWsId}, ${adminUserId},
             ${adminUserId}, 'added', ${ROLE_ID_WORKSPACE_ADMIN})
        `;
      });

      return { adminUserId };
    },
  };
}

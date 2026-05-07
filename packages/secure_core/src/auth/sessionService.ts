import type { Capability } from "../config/capabilities.js";
import { isCapability } from "../config/capabilities.js";
import type { SecureCorePool } from "../db/pool.js";
import type { ActorType } from "../middleware/types.js";

export interface CurrentSessionMembership {
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly role_id: string;
  readonly role_name: string;
  readonly capabilities: readonly Capability[];
}

export interface CurrentSessionResponse {
  readonly user_id: string;
  readonly session_id: string;
  readonly actor_type: Exclude<ActorType, "unauthenticated">;
  readonly assurance_level: "aal1" | "aal2" | "aal3";
  readonly memberships: readonly CurrentSessionMembership[];
}

export interface CurrentSessionAuth {
  readonly userId: string;
  readonly sessionId: string;
  readonly actorType: Exclude<ActorType, "unauthenticated">;
  readonly assuranceLevel: "aal1" | "aal2" | "aal3";
}

export interface CurrentSessionReader {
  getCurrentSession(auth: CurrentSessionAuth): Promise<CurrentSessionResponse>;
}

interface MembershipRow {
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly role_id: string;
  readonly role_name: string;
  readonly capability: string | null;
}

function toCapability(value: string | null): Capability | null {
  return value !== null && isCapability(value) ? value : null;
}

function groupMemberships(
  rows: readonly MembershipRow[],
): readonly CurrentSessionMembership[] {
  const byWorkspace = new Map<string, {
    workspace_id: string;
    workspace_name: string;
    role_id: string;
    role_name: string;
    capabilities: Set<Capability>;
  }>();

  for (const row of rows) {
    let entry = byWorkspace.get(row.workspace_id);
    if (entry === undefined) {
      entry = {
        workspace_id: row.workspace_id,
        workspace_name: row.workspace_name,
        role_id: row.role_id,
        role_name: row.role_name,
        capabilities: new Set<Capability>(),
      };
      byWorkspace.set(row.workspace_id, entry);
    }
    const capability = toCapability(row.capability);
    if (capability !== null) {
      entry.capabilities.add(capability);
    }
  }

  return [...byWorkspace.values()].map((entry) => ({
    workspace_id: entry.workspace_id,
    workspace_name: entry.workspace_name,
    role_id: entry.role_id,
    role_name: entry.role_name,
    capabilities: [...entry.capabilities].sort(),
  }));
}

export interface SqlCurrentSessionReaderOptions {
  readonly appPool: SecureCorePool;
}

export class SqlCurrentSessionReader implements CurrentSessionReader {
  readonly #pool: SecureCorePool;

  public constructor(opts: SqlCurrentSessionReaderOptions) {
    if (opts.appPool.role !== "app") {
      throw new Error(
        `SqlCurrentSessionReader requires role="app"; got "${opts.appPool.role}"`,
      );
    }
    this.#pool = opts.appPool;
  }

  public async getCurrentSession(
    auth: CurrentSessionAuth,
  ): Promise<CurrentSessionResponse> {
    const rows = await this.#pool.sql<MembershipRow[]>`
      SELECT
        wm.workspace_id,
        w.name AS workspace_name,
        wm.role_id,
        r.name AS role_name,
        rp.capability
      FROM workspace_memberships wm
      INNER JOIN workspaces w ON w.id = wm.workspace_id
      INNER JOIN roles r ON r.id = wm.role_id
      -- Preserve live memberships even when a role currently grants no capabilities.
      LEFT JOIN role_permissions rp ON rp.role_id = wm.role_id
      WHERE wm.user_id = ${auth.userId}::uuid
        AND wm.removed_at IS NULL
        AND w.deleted_at IS NULL
      ORDER BY w.name ASC, rp.capability ASC
    `;

    return {
      user_id: auth.userId,
      session_id: auth.sessionId,
      actor_type: auth.actorType,
      assurance_level: auth.assuranceLevel,
      memberships: groupMemberships(rows),
    };
  }
}

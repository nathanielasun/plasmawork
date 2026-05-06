/**
 * Test fixture factories — Phase 0.5 Layer-1 (L1.5).
 *
 * Per `IMPLEMENTATION_MANIFEST.md` §4, every factory MUST:
 *   1. accept `overrides` for every column,
 *   2. default required fields to deterministic, reproducible values,
 *   3. INSERT into the test DB and RETURN the persisted row,
 *   4. NEVER write to `audit_events` / `provenance_events` /
 *      `operator_events` (those are AuditLogger's job; tests that need
 *      log rows mock the writer or call AuditLogger directly).
 *
 * Factories accept a postgres-js `Sql` client as their first argument.
 * For ergonomics, `bindFactories(sql)` returns a record of factories
 * with the client closed over so call sites read like the manifest's
 * "make X with overrides" examples.
 *
 * The §13 `roles` table is seeded by migration 0002 — `getRoleId(sql,
 * name)` looks one up by name without re-seeding.
 */

import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

// ---------------------------------------------------------------------------
// Row shapes — narrowed views of the schema.ts tables.
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  session_hash: string;
  auth_method: string;
  assurance_level: string;
  expires_at: Date;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  created_by: string;
}

export interface MembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role_id: string;
}

export interface CapsuleRow {
  id: string;
  workspace_id: string;
  name: string;
  current_version_id: string | null;
  created_by: string;
}

export interface CapsuleVersionRow {
  id: string;
  capsule_id: string;
  workspace_id: string;
  version_number: number;
  content_hash: string;
  storage_path: string;
  created_by: string;
}

export interface RunRow {
  id: string;
  workspace_id: string;
  capsule_id: string;
  capsule_version_id: string;
  status: string;
  backend: string;
  requested_by: string;
}

export interface ToolRow {
  id: string;
  workspace_id: string | null;
  name: string;
  status: string;
  created_by: string;
}

export interface ApprovalRequestRow {
  id: string;
  workspace_id: string;
  object_type: string;
  object_id: string;
  requested_action: string;
  requested_by: string;
  status: string;
}

export interface ApprovalTokenRow {
  id: string;
  workspace_id: string;
  approval_request_id: string;
  token_hash: string;
  token_context_hash: string;
  approver_user_id: string | null;
  approver_role_id: string | null;
  created_by: string;
  expires_at: Date;
}

export interface StorageReservationRow {
  id: string;
  workspace_id: string;
  requested_by: string;
  bytes_reserved: bigint;
  status: string;
  expires_at: Date;
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

let counter = 0;
function nextSeq(): number {
  counter += 1;
  return counter;
}

/** Reset the in-process counter. Tests that pin "deterministic email"
 * expectations call this in beforeEach to keep the seq stable across
 * runs of the same file. */
export function resetCounters(): void {
  counter = 0;
}

function deterministicEmail(): string {
  return `user_${nextSeq()}@example.test`;
}

/** Future-dated TIMESTAMPTZ. Default = +1h. */
function inAnHour(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

/** Look up a §13 role by name. Throws if migration 0002 hasn't run. */
export async function getRoleId(sql: Sql, name: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM roles WHERE name = ${name}
  `;
  if (rows.length === 0) {
    throw new Error(
      `getRoleId: role "${name}" not found. Did migration 0002 run?`,
    );
  }
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export interface MakeUserOverrides {
  id?: string;
  email?: string;
  display_name?: string | null;
}

export async function makeUser(
  sql: Sql,
  overrides: MakeUserOverrides = {},
): Promise<UserRow> {
  const id = overrides.id ?? randomUUID();
  const email = overrides.email ?? deterministicEmail();
  const displayName =
    overrides.display_name === undefined ? null : overrides.display_name;
  const rows = await sql<UserRow[]>`
    INSERT INTO users (id, email, display_name)
    VALUES (${id}, ${email}, ${displayName})
    RETURNING id, email, display_name
  `;
  return rows[0];
}

export interface MakeSessionOverrides {
  id?: string;
  session_hash?: string;
  auth_method?: "oidc" | "password" | "webauthn" | "sso";
  assurance_level?: "aal1" | "aal2" | "aal3";
  expires_at?: Date;
}

export async function makeSession(
  sql: Sql,
  user: UserRow,
  overrides: MakeSessionOverrides = {},
): Promise<SessionRow> {
  const id = overrides.id ?? randomUUID();
  const sessionHash =
    overrides.session_hash ?? `sess_${nextSeq()}_${id.slice(0, 8)}`;
  const authMethod = overrides.auth_method ?? "sso";
  const assuranceLevel = overrides.assurance_level ?? "aal2";
  const expiresAt = overrides.expires_at ?? inAnHour();
  const rows = await sql<SessionRow[]>`
    INSERT INTO sessions (id, user_id, session_hash, auth_method,
                          assurance_level, expires_at)
    VALUES (${id}, ${user.id}, ${sessionHash}, ${authMethod},
            ${assuranceLevel}, ${expiresAt})
    RETURNING id, user_id, session_hash, auth_method,
              assurance_level, expires_at
  `;
  return rows[0];
}

export interface MakeWorkspaceOverrides {
  id?: string;
  name?: string;
}

export async function makeWorkspace(
  sql: Sql,
  creator: UserRow,
  overrides: MakeWorkspaceOverrides = {},
): Promise<WorkspaceRow> {
  const id = overrides.id ?? randomUUID();
  const name = overrides.name ?? `workspace_${nextSeq()}`;
  const rows = await sql<WorkspaceRow[]>`
    INSERT INTO workspaces (id, name, created_by)
    VALUES (${id}, ${name}, ${creator.id})
    RETURNING id, name, created_by
  `;
  return rows[0];
}

export interface MakeMemberOverrides {
  id?: string;
}

/**
 * Add a user to a workspace under the named §13 role. Resolves the role
 * by name via `getRoleId`. Pass a different `roleName` to grant any of
 * the nine seeded roles (Researcher, WorkspaceAdmin, Reviewer, etc.).
 */
export async function makeMember(
  sql: Sql,
  workspace: WorkspaceRow,
  user: UserRow,
  roleName: string = "Researcher",
  overrides: MakeMemberOverrides = {},
): Promise<MembershipRow> {
  const id = overrides.id ?? randomUUID();
  const roleId = await getRoleId(sql, roleName);
  const rows = await sql<MembershipRow[]>`
    INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id)
    VALUES (${id}, ${workspace.id}, ${user.id}, ${roleId})
    RETURNING id, workspace_id, user_id, role_id
  `;
  return rows[0];
}

export interface MakeCapsuleOverrides {
  id?: string;
  name?: string;
  /**
   * If `false`, the capsule is created without an initial version and
   * `current_version_id` stays NULL. Default `true`: a v1 capsule
   * version is also inserted and pointed at by `current_version_id`.
   */
  withInitialVersion?: boolean;
}

export interface CapsuleAndVersion {
  capsule: CapsuleRow;
  version: CapsuleVersionRow | null;
}

/**
 * Default behavior: insert capsule + its v1 version + set
 * `current_version_id`. The combined object is returned so downstream
 * factories (`makeRun`) can reference the version without a second
 * lookup.
 */
export async function makeCapsule(
  sql: Sql,
  workspace: WorkspaceRow,
  creator: UserRow,
  overrides: MakeCapsuleOverrides = {},
): Promise<CapsuleAndVersion> {
  const capsuleId = overrides.id ?? randomUUID();
  const name = overrides.name ?? `capsule_${nextSeq()}`;
  const withVersion = overrides.withInitialVersion !== false;

  const capsuleRows = await sql<CapsuleRow[]>`
    INSERT INTO capsules (id, workspace_id, name, created_by)
    VALUES (${capsuleId}, ${workspace.id}, ${name}, ${creator.id})
    RETURNING id, workspace_id, name, current_version_id, created_by
  `;
  const capsule = capsuleRows[0];

  if (!withVersion) {
    return { capsule, version: null };
  }

  const versionId = randomUUID();
  const contentHash = `sha256:${versionId.replace(/-/g, "")}`;
  const storagePath = `workspaces/${workspace.id}/capsules/${capsuleId}/v1`;
  const versionRows = await sql<CapsuleVersionRow[]>`
    INSERT INTO capsule_versions
      (id, capsule_id, workspace_id, version_number, content_hash,
       storage_path, created_by)
    VALUES (${versionId}, ${capsuleId}, ${workspace.id}, 1, ${contentHash},
            ${storagePath}, ${creator.id})
    RETURNING id, capsule_id, workspace_id, version_number, content_hash,
              storage_path, created_by
  `;
  const version = versionRows[0];

  await sql`
    UPDATE capsules SET current_version_id = ${version.id}
    WHERE id = ${capsuleId}
  `;
  capsule.current_version_id = version.id;
  return { capsule, version };
}

export interface MakeRunOverrides {
  id?: string;
  status?:
    | "created"
    | "approval_required"
    | "queued"
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "cancel_requested"
    | "cancelled"
    | "expired";
  backend?: string;
  capsule_version_id?: string;
}

/**
 * `capsuleAndVersion` is the return value of `makeCapsule`. The version
 * id is required by simulation_runs; if you need a fresh version per
 * run, supply `overrides.capsule_version_id` after calling
 * `makeCapsuleVersion(...)` separately.
 */
export async function makeRun(
  sql: Sql,
  workspace: WorkspaceRow,
  capsuleAndVersion: CapsuleAndVersion,
  requester: UserRow,
  overrides: MakeRunOverrides = {},
): Promise<RunRow> {
  const id = overrides.id ?? randomUUID();
  const status = overrides.status ?? "created";
  const backend = overrides.backend ?? "python_cpu";
  const versionId =
    overrides.capsule_version_id ?? capsuleAndVersion.version?.id;
  if (!versionId) {
    throw new Error(
      "makeRun: capsule has no version. Pass capsule_version_id or " +
        "create the capsule with `withInitialVersion` defaulting on.",
    );
  }
  const rows = await sql<RunRow[]>`
    INSERT INTO simulation_runs
      (id, workspace_id, capsule_id, capsule_version_id, status,
       backend, requested_by)
    VALUES (${id}, ${workspace.id}, ${capsuleAndVersion.capsule.id},
            ${versionId}, ${status}, ${backend}, ${requester.id})
    RETURNING id, workspace_id, capsule_id, capsule_version_id, status,
              backend, requested_by
  `;
  return rows[0];
}

export interface MakeToolOverrides {
  id?: string;
  name?: string;
  status?: "draft" | "candidate" | "validated" | "trusted" | "deprecated";
  workspace_scoped?: boolean;
}

/**
 * Tools may be workspace-scoped (workspace_id NOT NULL) or platform-wide
 * (workspace_id NULL). Default: workspace-scoped at draft.
 */
export async function makeTool(
  sql: Sql,
  workspace: WorkspaceRow,
  creator: UserRow,
  overrides: MakeToolOverrides = {},
): Promise<ToolRow> {
  const id = overrides.id ?? randomUUID();
  const name = overrides.name ?? `tool_${nextSeq()}`;
  const status = overrides.status ?? "draft";
  const workspaceScoped = overrides.workspace_scoped !== false;
  const wsId = workspaceScoped ? workspace.id : null;
  const rows = await sql<ToolRow[]>`
    INSERT INTO tools (id, workspace_id, name, status, created_by)
    VALUES (${id}, ${wsId}, ${name}, ${status}, ${creator.id})
    RETURNING id, workspace_id, name, status, created_by
  `;
  return rows[0];
}

export interface MakeApprovalRequestOverrides {
  id?: string;
  object_type?: string;
  object_id?: string;
  status?: "pending" | "approved" | "denied" | "revoked" | "expired";
  requested_by_agent?: boolean;
}

export async function makeApprovalRequest(
  sql: Sql,
  workspace: WorkspaceRow,
  requester: UserRow,
  requestedAction: string,
  overrides: MakeApprovalRequestOverrides = {},
): Promise<ApprovalRequestRow> {
  const id = overrides.id ?? randomUUID();
  const objectType = overrides.object_type ?? "capsule";
  const objectId = overrides.object_id ?? randomUUID();
  const status = overrides.status ?? "pending";
  const requestedByAgent = overrides.requested_by_agent ?? false;
  const rows = await sql<ApprovalRequestRow[]>`
    INSERT INTO approval_requests
      (id, workspace_id, object_type, object_id, requested_action,
       requested_by, requested_by_agent, status)
    VALUES (${id}, ${workspace.id}, ${objectType}, ${objectId},
            ${requestedAction}, ${requester.id}, ${requestedByAgent}, ${status})
    RETURNING id, workspace_id, object_type, object_id, requested_action,
              requested_by, status
  `;
  return rows[0];
}

export interface MakeApprovalTokenOverrides {
  id?: string;
  token_hash?: string;
  token_context_hash?: string;
  approver_user_id?: string | null;
  approver_role_id?: string | null;
  created_by?: string;
  expires_at?: Date;
}

/**
 * Approval tokens require either `approver_user_id` or
 * `approver_role_id` to be set (CHECK constraint). Default: bind to a
 * specific approver-user; pass `approver_user_id: null` and a role id
 * to switch to role-bound.
 */
export async function makeApprovalToken(
  sql: Sql,
  request: ApprovalRequestRow,
  approver: UserRow,
  overrides: MakeApprovalTokenOverrides = {},
): Promise<ApprovalTokenRow> {
  const id = overrides.id ?? randomUUID();
  const tokenHash =
    overrides.token_hash ?? `tokenhash_${nextSeq()}_${id.slice(0, 8)}`;
  const tokenContextHash =
    overrides.token_context_hash ?? `ctxhash_${nextSeq()}_${id.slice(0, 8)}`;
  const approverUserId =
    overrides.approver_user_id === undefined
      ? approver.id
      : overrides.approver_user_id;
  const approverRoleId = overrides.approver_role_id ?? null;
  const createdBy = overrides.created_by ?? approver.id;
  const expiresAt = overrides.expires_at ?? inAnHour();
  const rows = await sql<ApprovalTokenRow[]>`
    INSERT INTO approval_tokens
      (id, workspace_id, approval_request_id, token_hash, token_context_hash,
       approver_user_id, approver_role_id, created_by, expires_at)
    VALUES (${id}, ${request.workspace_id}, ${request.id}, ${tokenHash},
            ${tokenContextHash}, ${approverUserId}, ${approverRoleId},
            ${createdBy}, ${expiresAt})
    RETURNING id, workspace_id, approval_request_id, token_hash,
              token_context_hash, approver_user_id, approver_role_id,
              created_by, expires_at
  `;
  return rows[0];
}

export interface MakeStorageReservationOverrides {
  id?: string;
  status?: "reserved" | "committed" | "released" | "expired";
  expires_at?: Date;
}

export async function makeStorageReservation(
  sql: Sql,
  workspace: WorkspaceRow,
  requester: UserRow,
  bytes: bigint | number,
  overrides: MakeStorageReservationOverrides = {},
): Promise<StorageReservationRow> {
  const id = overrides.id ?? randomUUID();
  const status = overrides.status ?? "reserved";
  const expiresAt = overrides.expires_at ?? inAnHour();
  // postgres-js's tagged-template parameter type does not include bigint
  // by default. Send the value as a decimal string and let Postgres
  // parse it into BIGINT. Round-trips identically for non-negative
  // integers (which the CHECK constraint already enforces).
  const bytesReserved = (
    typeof bytes === "bigint" ? bytes : BigInt(bytes)
  ).toString();
  const rows = await sql<StorageReservationRow[]>`
    INSERT INTO storage_reservations
      (id, workspace_id, requested_by, bytes_reserved, status, expires_at)
    VALUES (${id}, ${workspace.id}, ${requester.id}, ${bytesReserved}::bigint,
            ${status}, ${expiresAt})
    RETURNING id, workspace_id, requested_by, bytes_reserved, status, expires_at
  `;
  return rows[0];
}

// ---------------------------------------------------------------------------
// Bound factory bundle
// ---------------------------------------------------------------------------

/**
 * Returns every factory with `sql` closed over. Use this in tests where
 * passing the client into every call adds noise:
 *
 *   const f = bindFactories(sql);
 *   const u = await f.makeUser({ email: "alice@example.test" });
 *   const w = await f.makeWorkspace(u);
 *   const m = await f.makeMember(w, u, "Researcher");
 */
export function bindFactories(sql: Sql) {
  return {
    makeUser: (overrides?: MakeUserOverrides) => makeUser(sql, overrides),
    makeSession: (user: UserRow, overrides?: MakeSessionOverrides) =>
      makeSession(sql, user, overrides),
    makeWorkspace: (creator: UserRow, overrides?: MakeWorkspaceOverrides) =>
      makeWorkspace(sql, creator, overrides),
    makeMember: (
      workspace: WorkspaceRow,
      user: UserRow,
      roleName?: string,
      overrides?: MakeMemberOverrides,
    ) => makeMember(sql, workspace, user, roleName, overrides),
    makeCapsule: (
      workspace: WorkspaceRow,
      creator: UserRow,
      overrides?: MakeCapsuleOverrides,
    ) => makeCapsule(sql, workspace, creator, overrides),
    makeRun: (
      workspace: WorkspaceRow,
      capsule: CapsuleAndVersion,
      requester: UserRow,
      overrides?: MakeRunOverrides,
    ) => makeRun(sql, workspace, capsule, requester, overrides),
    makeTool: (
      workspace: WorkspaceRow,
      creator: UserRow,
      overrides?: MakeToolOverrides,
    ) => makeTool(sql, workspace, creator, overrides),
    makeApprovalRequest: (
      workspace: WorkspaceRow,
      requester: UserRow,
      action: string,
      overrides?: MakeApprovalRequestOverrides,
    ) => makeApprovalRequest(sql, workspace, requester, action, overrides),
    makeApprovalToken: (
      request: ApprovalRequestRow,
      approver: UserRow,
      overrides?: MakeApprovalTokenOverrides,
    ) => makeApprovalToken(sql, request, approver, overrides),
    makeStorageReservation: (
      workspace: WorkspaceRow,
      requester: UserRow,
      bytes: bigint | number,
      overrides?: MakeStorageReservationOverrides,
    ) =>
      makeStorageReservation(sql, workspace, requester, bytes, overrides),
    getRoleId: (name: string) => getRoleId(sql, name),
  };
}

export type Factories = ReturnType<typeof bindFactories>;

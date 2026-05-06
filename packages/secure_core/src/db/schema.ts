/**
 * Drizzle schema — Phase 0.5 Layer-1 (L1.8).
 *
 * 26 tables from `secure_multi_user_scaffolding_plan_v4.md` §11/§12.
 * Column types, NOT NULL, CHECK constraints, foreign keys, partial
 * unique indexes, and the V4-R3/R6/R7 fixes match v4 column-by-column.
 *
 * Conventions:
 * - All `id` columns are `uuid PRIMARY KEY` with no DB-side default;
 *   producers generate UUIDs (UUIDv7 in middleware) before INSERT.
 * - Timestamps are `timestamp with time zone` (TIMESTAMPTZ in v4).
 * - `metadata` columns are `jsonb`.
 * - Log tables carry `prev_hash`, `row_hash`, `canonicalization_version`;
 *   `row_hash` is NOT NULL, `prev_hash` is nullable for the first row.
 * - The §12.1 GRANT-based privilege restrictions are encoded in a
 *   separate migration (`0001_create_roles.sql`); the schema does not
 *   embed grants because Drizzle's introspection drops them.
 *
 * Cross-task note: L1.7 (DB pool / role-aware client) imports the
 * table objects from this file. Stable export names:
 *   users, sessions, passwordResetTokens, emailVerificationTokens,
 *   workspaces, roles, rolePermissions, workspaceMemberships,
 *   workspaceMembershipEvents, capsules, capsuleVersions, capsuleLocks,
 *   simulationRuns, runEvents, approvalRequests, approvalTokens,
 *   tools, toolVersions, toolPromotionRequests, artifactFiles,
 *   auditEvents, provenanceEvents, logChainAnchors, operatorEvents,
 *   quotaCounters, storageReservations.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Identity & sessions
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sessionHash: text("session_hash").notNull().unique(),
    authMethod: text("auth_method").notNull(),
    assuranceLevel: text("assurance_level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    authMethodCheck: check(
      "sessions_auth_method_check",
      sql`${t.authMethod} IN ('oidc', 'password', 'webauthn', 'sso')`,
    ),
    assuranceLevelCheck: check(
      "sessions_assurance_level_check",
      sql`${t.assuranceLevel} IN ('aal1', 'aal2', 'aal3')`,
    ),
  }),
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Workspaces, roles, memberships
// ---------------------------------------------------------------------------

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    capability: text("capability").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.capability] }),
  }),
);

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => ({
    activeUnique: uniqueIndex("workspace_memberships_active_unique")
      .on(t.workspaceId, t.userId)
      .where(sql`${t.removedAt} IS NULL`),
  }),
);

export const workspaceMembershipEvents = pgTable(
  "workspace_membership_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    oldRoleId: uuid("old_role_id").references(() => roles.id),
    newRoleId: uuid("new_role_id").references(() => roles.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    eventTypeCheck: check(
      "workspace_membership_events_event_type_check",
      sql`${t.eventType} IN ('added', 'removed', 'role_changed')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Capsules
// ---------------------------------------------------------------------------

export const capsules = pgTable("capsules", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name").notNull(),
  currentVersionId: uuid("current_version_id"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const capsuleVersions = pgTable(
  "capsule_versions",
  {
    id: uuid("id").primaryKey(),
    capsuleId: uuid("capsule_id")
      .notNull()
      .references(() => capsules.id),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    versionNumber: integer("version_number").notNull(),
    contentHash: text("content_hash").notNull(),
    storagePath: text("storage_path").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    capsuleVersionUnique: uniqueIndex("capsule_versions_capsule_version_unique").on(
      t.capsuleId,
      t.versionNumber,
    ),
  }),
);

export const capsuleLocks = pgTable("capsule_locks", {
  capsuleId: uuid("capsule_id")
    .primaryKey()
    .references(() => capsules.id),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  lockedBy: uuid("locked_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  lockTokenHash: text("lock_token_hash").notNull(),
  lockContextHash: text("lock_context_hash").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// Simulation runs
// ---------------------------------------------------------------------------

export const simulationRuns = pgTable(
  "simulation_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    capsuleId: uuid("capsule_id")
      .notNull()
      .references(() => capsules.id),
    capsuleVersionId: uuid("capsule_version_id")
      .notNull()
      .references(() => capsuleVersions.id),
    status: text("status").notNull(),
    backend: text("backend").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    cancellationReason: text("cancellation_reason"),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check(
      "simulation_runs_status_check",
      sql`${t.status} IN (
        'created',
        'approval_required',
        'queued',
        'running',
        'paused',
        'completed',
        'failed',
        'cancel_requested',
        'cancelled',
        'expired'
      )`,
    ),
  }),
);

export const runEvents = pgTable("run_events", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  runId: uuid("run_id")
    .notNull()
    .references(() => simulationRuns.id),
  eventType: text("event_type").notNull(),
  message: text("message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    requestedAction: text("requested_action").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedByAgent: boolean("requested_by_agent").notNull().default(false),
    status: text("status").notNull(),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    decidedByAgent: boolean("decided_by_agent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check(
      "approval_requests_status_check",
      sql`${t.status} IN ('pending', 'approved', 'denied', 'revoked', 'expired')`,
    ),
    decidedByAgentCheck: check(
      "approval_requests_decided_by_agent_check",
      sql`${t.decidedByAgent} = false`,
    ),
    decidedConsistencyCheck: check(
      "approval_requests_decided_consistency_check",
      sql`(
        (${t.status} IN ('pending', 'expired') AND ${t.decidedBy} IS NULL AND ${t.decidedAt} IS NULL)
        OR
        (${t.status} IN ('approved', 'denied', 'revoked') AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)
      )`,
    ),
  }),
);

export const approvalTokens = pgTable(
  "approval_tokens",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    approvalRequestId: uuid("approval_request_id")
      .notNull()
      .references(() => approvalRequests.id),
    tokenHash: text("token_hash").notNull().unique(),
    tokenContextHash: text("token_context_hash").notNull(),
    approverUserId: uuid("approver_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    approverRoleId: uuid("approver_role_id").references(() => roles.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    approverPresentCheck: check(
      "approval_tokens_approver_present_check",
      sql`${t.approverUserId} IS NOT NULL OR ${t.approverRoleId} IS NOT NULL`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const tools = pgTable(
  "tools",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    name: text("name").notNull(),
    status: text("status").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check(
      "tools_status_check",
      sql`${t.status} IN ('draft', 'candidate', 'validated', 'trusted', 'deprecated')`,
    ),
  }),
);

export const toolVersions = pgTable(
  "tool_versions",
  {
    id: uuid("id").primaryKey(),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    versionNumber: integer("version_number").notNull(),
    contentHash: text("content_hash").notNull(),
    storagePath: text("storage_path").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    toolVersionUnique: uniqueIndex("tool_versions_tool_version_unique").on(
      t.toolId,
      t.versionNumber,
    ),
  }),
);

export const toolPromotionRequests = pgTable(
  "tool_promotion_requests",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check(
      "tool_promotion_requests_status_check",
      sql`${t.status} IN ('pending', 'approved', 'denied', 'revoked')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export const artifactFiles = pgTable("artifact_files", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  artifactType: text("artifact_type").notNull(),
  storagePath: text("storage_path").notNull(),
  contentHash: text("content_hash"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// ---------------------------------------------------------------------------
// Audit / provenance / anchors / operator log (immutable / append-only)
// ---------------------------------------------------------------------------

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    // V4-R3: 'unauthenticated' for pre-auth events (login.failed,
    // csrf.failed before session establishment, anon rate-limit hits).
    actorType: text("actor_type").notNull(),
    action: text("action").notNull(),
    objectType: text("object_type"),
    objectId: uuid("object_id"),
    result: text("result").notNull(),
    requestId: text("request_id"),
    ipHmac: text("ip_hmac"),
    userAgentHmac: text("user_agent_hmac"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    prevHash: text("prev_hash"),
    rowHash: text("row_hash").notNull(),
    canonicalizationVersion: text("canonicalization_version")
      .notNull()
      .default("jcs-v1"),
  },
  (t) => ({
    actorTypeCheck: check(
      "audit_events_actor_type_check",
      sql`${t.actorType} IN ('human', 'ai_agent', 'worker', 'operator', 'unauthenticated')`,
    ),
  }),
);

export const provenanceEvents = pgTable(
  "provenance_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    actorType: text("actor_type").notNull(),
    capsuleId: uuid("capsule_id").references(() => capsules.id),
    runId: uuid("run_id").references(() => simulationRuns.id),
    action: text("action").notNull(),
    objectType: text("object_type"),
    objectId: uuid("object_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    prevHash: text("prev_hash"),
    rowHash: text("row_hash").notNull(),
    canonicalizationVersion: text("canonicalization_version")
      .notNull()
      .default("jcs-v1"),
  },
  (t) => ({
    actorTypeCheck: check(
      "provenance_events_actor_type_check",
      sql`${t.actorType} IN ('human', 'ai_agent', 'worker', 'operator')`,
    ),
  }),
);

export const logChainAnchors = pgTable(
  "log_chain_anchors",
  {
    id: uuid("id").primaryKey(),
    logType: text("log_type").notNull(),
    anchorHash: text("anchor_hash").notNull(),
    anchoredRowId: uuid("anchored_row_id").notNull(),
    externalAnchorUri: text("external_anchor_uri").notNull(),
    committedBy: uuid("committed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    committedAt: timestamp("committed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    canonicalizationVersion: text("canonicalization_version")
      .notNull()
      .default("jcs-v1"),
  },
  (t) => ({
    logTypeCheck: check(
      "log_chain_anchors_log_type_check",
      sql`${t.logType} IN ('audit_events', 'provenance_events', 'operator_events')`,
    ),
    externalAnchorUriVersionCheck: check(
      "log_chain_anchors_external_anchor_uri_has_version_id",
      sql`${t.externalAnchorUri} LIKE '%versionId=%'`,
    ),
  }),
);

export const operatorEvents = pgTable(
  "operator_events",
  {
    id: uuid("id").primaryKey(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    capability: text("capability").notNull(),
    reason: text("reason").notNull(),
    targetWorkspaceId: uuid("target_workspace_id").references(
      () => workspaces.id,
    ),
    targetUserId: uuid("target_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    // V4-R7: every operator event MUST cite a paired audit_events row.
    audit_event_id: uuid("audit_event_id")
      .notNull()
      .references(() => auditEvents.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    prevHash: text("prev_hash"),
    rowHash: text("row_hash").notNull(),
    canonicalizationVersion: text("canonicalization_version")
      .notNull()
      .default("jcs-v1"),
  },
  (t) => ({
    capabilityCheck: check(
      "operator_events_capability_check",
      sql`${t.capability} IN (
        'platform:audit_read',
        'platform:incident_investigate',
        'platform:incident_remediate'
      )`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Quotas & storage (§21)
// ---------------------------------------------------------------------------

export const quotaCounters = pgTable(
  "quota_counters",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    quotaKey: text("quota_key").notNull(),
    currentValue: bigint("current_value", { mode: "bigint" })
      .notNull()
      .default(0n),
    limitValue: bigint("limit_value", { mode: "bigint" }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.quotaKey] }),
    // V4-R6: both NULL (cumulative) or both NOT NULL with end > start.
    periodCheck: check(
      "quota_counters_period_check",
      sql`(
        (${t.periodStart} IS NULL AND ${t.periodEnd} IS NULL)
        OR
        (${t.periodStart} IS NOT NULL AND ${t.periodEnd} IS NOT NULL
          AND ${t.periodEnd} > ${t.periodStart})
      )`,
    ),
  }),
);

export const storageReservations = pgTable(
  "storage_reservations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    bytesReserved: bigint("bytes_reserved", { mode: "bigint" }).notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    statusCheck: check(
      "storage_reservations_status_check",
      sql`${t.status} IN ('reserved', 'committed', 'released', 'expired')`,
    ),
    bytesCheck: check(
      "storage_reservations_bytes_check",
      sql`${t.bytesReserved} >= 0`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// All-tables export — convenience for migrations / introspection.
// ---------------------------------------------------------------------------

export const ALL_TABLES = {
  users,
  sessions,
  passwordResetTokens,
  emailVerificationTokens,
  workspaces,
  roles,
  rolePermissions,
  workspaceMemberships,
  workspaceMembershipEvents,
  capsules,
  capsuleVersions,
  capsuleLocks,
  simulationRuns,
  runEvents,
  approvalRequests,
  approvalTokens,
  tools,
  toolVersions,
  toolPromotionRequests,
  artifactFiles,
  auditEvents,
  provenanceEvents,
  logChainAnchors,
  operatorEvents,
  quotaCounters,
  storageReservations,
} as const;

export const ALL_TABLE_NAMES = [
  "users",
  "sessions",
  "password_reset_tokens",
  "email_verification_tokens",
  "workspaces",
  "roles",
  "role_permissions",
  "workspace_memberships",
  "workspace_membership_events",
  "capsules",
  "capsule_versions",
  "capsule_locks",
  "simulation_runs",
  "run_events",
  "approval_requests",
  "approval_tokens",
  "tools",
  "tool_versions",
  "tool_promotion_requests",
  "artifact_files",
  "audit_events",
  "provenance_events",
  "log_chain_anchors",
  "operator_events",
  "quota_counters",
  "storage_reservations",
] as const;

/**
 * Tables on which `secure_core_app` has INSERT-only privileges
 * per v4 §12.1.2. ADR-0010 removes `log_chain_anchors` from this
 * app-writable set; only `secure_core_anchor_writer` may insert anchors.
 */
export const APPEND_ONLY_TABLES = [
  "audit_events",
  "provenance_events",
  "operator_events",
  "workspace_membership_events",
] as const;

export const ANCHOR_WRITER_ONLY_TABLES = [
  "log_chain_anchors",
] as const;

/**
 * Tables on which `secure_core_audit_read` has SELECT-only privileges
 * per v4 §12.1.3 (Option A — separate audit-read role).
 */
export const AUDIT_READ_TABLES = [
  "audit_events",
  "provenance_events",
  "operator_events",
  "log_chain_anchors",
] as const;

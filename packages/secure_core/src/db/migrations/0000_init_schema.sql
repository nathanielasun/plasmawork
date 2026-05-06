-- Phase 0.5 / Layer-1 / L1.8 — initial schema migration.
--
-- Source of truth: secure_multi_user_scaffolding_plan_v4.md §11/§12.
-- 28 tables with v4 column types, CHECKs, FKs, partial unique index,
-- and the V4-R3/R6/R7 fixes embedded.
--
-- This migration is owned by `secure_core_migrator`. The `0001_create_roles.sql`
-- migration creates the application/audit-read/anchor-writer roles and grants
-- their privileges per §12.1; do not embed grants here.
--
-- Idempotency: this migration MUST run exactly once on a clean DB. Drizzle's
-- `__drizzle_migrations` ledger tracks application; we deliberately avoid
-- `IF NOT EXISTS` on CREATE TABLE so any drift surfaces loudly.

-- ---------------------------------------------------------------------------
-- Identity & sessions
-- ---------------------------------------------------------------------------

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY,
  "email" text UNIQUE NOT NULL,
  "email_verified_at" timestamp with time zone,
  "display_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "disabled_at" timestamp with time zone
);

CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "session_hash" text UNIQUE NOT NULL,
  "auth_method" text NOT NULL,
  "assurance_level" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "sessions_auth_method_check"
    CHECK ("auth_method" IN ('oidc', 'password', 'webauthn', 'sso')),
  CONSTRAINT "sessions_assurance_level_check"
    CHECK ("assurance_level" IN ('aal1', 'aal2', 'aal3'))
);

CREATE TABLE "password_reset_tokens" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "token_hash" text UNIQUE NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);

CREATE TABLE "email_verification_tokens" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "email" text NOT NULL,
  "token_hash" text UNIQUE NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone
);

-- ---------------------------------------------------------------------------
-- Workspaces, roles, memberships
-- ---------------------------------------------------------------------------

CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE TABLE "roles" (
  "id" uuid PRIMARY KEY,
  "name" text UNIQUE NOT NULL,
  "description" text
);

CREATE TABLE "role_permissions" (
  "role_id" uuid NOT NULL REFERENCES "roles"("id"),
  "capability" text NOT NULL,
  PRIMARY KEY ("role_id", "capability")
);

CREATE TABLE "workspace_memberships" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "role_id" uuid NOT NULL REFERENCES "roles"("id"),
  "created_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "removed_at" timestamp with time zone
);

CREATE UNIQUE INDEX "workspace_memberships_active_unique"
  ON "workspace_memberships" ("workspace_id", "user_id")
  WHERE "removed_at" IS NULL;

CREATE TABLE "workspace_membership_events" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "target_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "event_type" text NOT NULL,
  "old_role_id" uuid REFERENCES "roles"("id"),
  "new_role_id" uuid REFERENCES "roles"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_membership_events_event_type_check"
    CHECK ("event_type" IN ('added', 'removed', 'role_changed'))
);

-- ---------------------------------------------------------------------------
-- Capsules
-- ---------------------------------------------------------------------------

CREATE TABLE "capsules" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "name" text NOT NULL,
  "current_version_id" uuid,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE TABLE "capsule_versions" (
  "id" uuid PRIMARY KEY,
  "capsule_id" uuid NOT NULL REFERENCES "capsules"("id"),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "version_number" integer NOT NULL,
  "content_hash" text NOT NULL,
  "storage_path" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "capsule_versions_capsule_version_unique"
  ON "capsule_versions" ("capsule_id", "version_number");

CREATE TABLE "capsule_locks" (
  "capsule_id" uuid PRIMARY KEY REFERENCES "capsules"("id"),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "locked_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "lock_token_hash" text NOT NULL,
  "lock_context_hash" text NOT NULL,
  "locked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL
);

-- ---------------------------------------------------------------------------
-- Simulation runs
-- ---------------------------------------------------------------------------

CREATE TABLE "simulation_runs" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "capsule_id" uuid NOT NULL REFERENCES "capsules"("id"),
  "capsule_version_id" uuid NOT NULL REFERENCES "capsule_versions"("id"),
  "status" text NOT NULL,
  "backend" text NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "cancellation_reason" text,
  "failure_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "canceled_at" timestamp with time zone,
  CONSTRAINT "simulation_runs_status_check" CHECK ("status" IN (
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
  ))
);

CREATE TABLE "run_events" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "run_id" uuid NOT NULL REFERENCES "simulation_runs"("id"),
  "event_type" text NOT NULL,
  "message" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------

CREATE TABLE "approval_requests" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "object_type" text NOT NULL,
  "object_id" uuid NOT NULL,
  "requested_action" text NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "requested_by_agent" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "decided_by_agent" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "decided_at" timestamp with time zone,
  CONSTRAINT "approval_requests_status_check"
    CHECK ("status" IN ('pending', 'approved', 'denied', 'revoked', 'expired')),
  CONSTRAINT "approval_requests_decided_by_agent_check"
    CHECK ("decided_by_agent" = false),
  CONSTRAINT "approval_requests_decided_consistency_check" CHECK (
    (
      "status" IN ('pending', 'expired')
      AND "decided_by" IS NULL
      AND "decided_at" IS NULL
    )
    OR
    (
      "status" IN ('approved', 'denied', 'revoked')
      AND "decided_by" IS NOT NULL
      AND "decided_at" IS NOT NULL
    )
  )
);

CREATE TABLE "approval_tokens" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "approval_request_id" uuid NOT NULL REFERENCES "approval_requests"("id"),
  "token_hash" text UNIQUE NOT NULL,
  "token_context_hash" text NOT NULL,
  "approver_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "approver_role_id" uuid REFERENCES "roles"("id"),
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "approval_tokens_approver_present_check"
    CHECK ("approver_user_id" IS NOT NULL OR "approver_role_id" IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Tools
-- ---------------------------------------------------------------------------

CREATE TABLE "tools" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid REFERENCES "workspaces"("id"),
  "name" text NOT NULL,
  "status" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "tools_status_check"
    CHECK ("status" IN ('draft', 'candidate', 'validated', 'trusted', 'deprecated'))
);

CREATE TABLE "tool_versions" (
  "id" uuid PRIMARY KEY,
  "tool_id" uuid NOT NULL REFERENCES "tools"("id"),
  "workspace_id" uuid REFERENCES "workspaces"("id"),
  "version_number" integer NOT NULL,
  "content_hash" text NOT NULL,
  "storage_path" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "tool_versions_tool_version_unique"
  ON "tool_versions" ("tool_id", "version_number");

CREATE TABLE "tool_promotion_requests" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "tool_id" uuid NOT NULL REFERENCES "tools"("id"),
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "status" text NOT NULL,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "decided_at" timestamp with time zone,
  CONSTRAINT "tool_promotion_requests_status_check"
    CHECK ("status" IN ('pending', 'approved', 'denied', 'revoked'))
);

-- ---------------------------------------------------------------------------
-- Artifacts
-- ---------------------------------------------------------------------------

CREATE TABLE "artifact_files" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "artifact_type" text NOT NULL,
  "storage_path" text NOT NULL,
  "content_hash" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit / provenance / anchors / operator log (immutable / append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid REFERENCES "workspaces"("id"),
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "actor_type" text NOT NULL,
  "action" text NOT NULL,
  "object_type" text,
  "object_id" uuid,
  "result" text NOT NULL,
  "request_id" text,
  "ip_hmac" text,
  "user_agent_hmac" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "prev_hash" text,
  "row_hash" text NOT NULL,
  "canonicalization_version" text NOT NULL DEFAULT 'jcs-v1',
  -- V4-R3: 'unauthenticated' is required for pre-auth events.
  CONSTRAINT "audit_events_actor_type_check" CHECK (
    "actor_type" IN ('human', 'ai_agent', 'worker', 'operator', 'unauthenticated')
  )
);

CREATE TABLE "provenance_events" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "actor_type" text NOT NULL,
  "capsule_id" uuid REFERENCES "capsules"("id"),
  "run_id" uuid REFERENCES "simulation_runs"("id"),
  "action" text NOT NULL,
  "object_type" text,
  "object_id" uuid,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "prev_hash" text,
  "row_hash" text NOT NULL,
  "canonicalization_version" text NOT NULL DEFAULT 'jcs-v1',
  CONSTRAINT "provenance_events_actor_type_check" CHECK (
    "actor_type" IN ('human', 'ai_agent', 'worker', 'operator')
  )
);

CREATE TABLE "log_chain_anchors" (
  "id" uuid PRIMARY KEY,
  "log_type" text NOT NULL,
  "anchor_hash" text NOT NULL,
  "anchored_row_id" uuid NOT NULL,
  "external_anchor_uri" text NOT NULL,
  "committed_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "committed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "canonicalization_version" text NOT NULL DEFAULT 'jcs-v1',
  CONSTRAINT "log_chain_anchors_log_type_check"
    CHECK ("log_type" IN ('audit_events', 'provenance_events', 'operator_events'))
);

CREATE TABLE "operator_events" (
  "id" uuid PRIMARY KEY,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "capability" text NOT NULL,
  "reason" text NOT NULL,
  "target_workspace_id" uuid REFERENCES "workspaces"("id"),
  "target_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE RESTRICT,
  -- V4-R7: every operator event MUST cite a paired audit_events row.
  "audit_event_id" uuid NOT NULL REFERENCES "audit_events"("id"),
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at" timestamp with time zone,
  "prev_hash" text,
  "row_hash" text NOT NULL,
  "canonicalization_version" text NOT NULL DEFAULT 'jcs-v1',
  CONSTRAINT "operator_events_capability_check" CHECK ("capability" IN (
    'platform:audit_read',
    'platform:incident_investigate',
    'platform:incident_remediate'
  ))
);

-- ---------------------------------------------------------------------------
-- Quotas & storage (§21)
-- ---------------------------------------------------------------------------

CREATE TABLE "quota_counters" (
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "quota_key" text NOT NULL,
  "current_value" bigint NOT NULL DEFAULT 0,
  "limit_value" bigint NOT NULL,
  "period_start" timestamp with time zone,
  "period_end" timestamp with time zone,
  PRIMARY KEY ("workspace_id", "quota_key"),
  -- V4-R6: both NULL (cumulative) or both NOT NULL with end > start.
  CONSTRAINT "quota_counters_period_check" CHECK (
    (
      "period_start" IS NULL AND "period_end" IS NULL
    )
    OR
    (
      "period_start" IS NOT NULL
      AND "period_end" IS NOT NULL
      AND "period_end" > "period_start"
    )
  )
);

CREATE TABLE "storage_reservations" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "requested_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "bytes_reserved" bigint NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "storage_reservations_status_check"
    CHECK ("status" IN ('reserved', 'committed', 'released', 'expired')),
  CONSTRAINT "storage_reservations_bytes_check"
    CHECK ("bytes_reserved" >= 0)
);

-- Phase 0.5 / Layer-1 / L1.8 — DB roles and privilege restrictions.
--
-- Source of truth: secure_multi_user_scaffolding_plan_v4.md §12.1.
-- Four PostgreSQL roles, each with the minimum privileges its surface needs.
--
--   secure_core_migrator      — owns all tables; full DDL + DML.
--   secure_core_app           — INSERT/SELECT/UPDATE/DELETE on mutable tables;
--                               INSERT-only on append-only log tables;
--                               NO SELECT on audit_events / provenance_events
--                               / operator_events (route reads through
--                               secure_core_audit_read after capability check).
--   secure_core_audit_read    — SELECT-only on audit/provenance/operator/anchor
--                               tables.
--   secure_core_anchor_writer — INSERT-only on log_chain_anchors (used by the
--                               external WORM committer per ADR-0010).
--
-- Idempotency: this migration MUST run cleanly twice on a fresh database.
-- Postgres has no `CREATE ROLE IF NOT EXISTS`, so each role is wrapped in a
-- DO block that catches the duplicate-object exception.

-- ---------------------------------------------------------------------------
-- 1. Create roles (idempotent via DO blocks).
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE ROLE secure_core_migrator NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE secure_core_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE secure_core_audit_read NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE secure_core_anchor_writer NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Schema usage. Without this, GRANT ... ON TABLE silently no-ops.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO
  secure_core_app,
  secure_core_audit_read,
  secure_core_anchor_writer;

-- The migrator role is the schema/table owner (set explicitly so default
-- privileges flow predictably). Skip ALTER OWNER if the migrator already owns.
ALTER TABLE "users"                          OWNER TO secure_core_migrator;
ALTER TABLE "sessions"                       OWNER TO secure_core_migrator;
ALTER TABLE "password_reset_tokens"          OWNER TO secure_core_migrator;
ALTER TABLE "email_verification_tokens"      OWNER TO secure_core_migrator;
ALTER TABLE "workspaces"                     OWNER TO secure_core_migrator;
ALTER TABLE "roles"                          OWNER TO secure_core_migrator;
ALTER TABLE "role_permissions"               OWNER TO secure_core_migrator;
ALTER TABLE "workspace_memberships"          OWNER TO secure_core_migrator;
ALTER TABLE "workspace_membership_events"    OWNER TO secure_core_migrator;
ALTER TABLE "capsules"                       OWNER TO secure_core_migrator;
ALTER TABLE "capsule_versions"               OWNER TO secure_core_migrator;
ALTER TABLE "capsule_locks"                  OWNER TO secure_core_migrator;
ALTER TABLE "simulation_runs"                OWNER TO secure_core_migrator;
ALTER TABLE "run_events"                     OWNER TO secure_core_migrator;
ALTER TABLE "approval_requests"              OWNER TO secure_core_migrator;
ALTER TABLE "approval_tokens"                OWNER TO secure_core_migrator;
ALTER TABLE "tools"                          OWNER TO secure_core_migrator;
ALTER TABLE "tool_versions"                  OWNER TO secure_core_migrator;
ALTER TABLE "tool_promotion_requests"        OWNER TO secure_core_migrator;
ALTER TABLE "artifact_files"                 OWNER TO secure_core_migrator;
ALTER TABLE "audit_events"                   OWNER TO secure_core_migrator;
ALTER TABLE "provenance_events"              OWNER TO secure_core_migrator;
ALTER TABLE "log_chain_anchors"              OWNER TO secure_core_migrator;
ALTER TABLE "operator_events"                OWNER TO secure_core_migrator;
ALTER TABLE "quota_counters"                 OWNER TO secure_core_migrator;
ALTER TABLE "storage_reservations"           OWNER TO secure_core_migrator;

-- ---------------------------------------------------------------------------
-- 3. secure_core_app — full DML on mutable tables.
--
-- Mutable tables: tables that the application updates / deletes during normal
-- operation. Excludes the §12.1.2 / §12.1.4 append-only set.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "users",
  "sessions",
  "password_reset_tokens",
  "email_verification_tokens",
  "workspaces",
  "roles",
  "role_permissions",
  "workspace_memberships",
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
  "quota_counters",
  "storage_reservations"
TO secure_core_app;

-- Note: run_events is INSERT/SELECT-only in spirit (v4 §12.1.2 says
-- "prefer append-only run_events"). The application does not UPDATE or DELETE
-- rows in run_events. We keep DML rights here so the §29 #51-54 contract test
-- can prove the §12.1.2 *log* tables (audit/provenance/operator/anchor/
-- workspace_membership_events) are the actually-immutable set. If a future
-- ADR makes run_events strictly append-only at the DB level, REVOKE here.

-- ---------------------------------------------------------------------------
-- 4. secure_core_app — INSERT-only on append-only log tables (§12.1.2).
--
-- ADR-0010 narrows log_chain_anchors further: only the anchor-writer
-- role may INSERT anchor rows. The app role emits audit/provenance/
-- operator/membership events, but never commits external anchors.
-- ---------------------------------------------------------------------------

GRANT INSERT ON TABLE
  "audit_events",
  "provenance_events",
  "operator_events",
  "workspace_membership_events"
TO secure_core_app;

-- §12.1.3: the app role does NOT have broad SELECT on audit/provenance/
-- operator. Reads route through secure_core_audit_read after capability
-- check. The app role does need SELECT on workspace_membership_events
-- (§12.1.2 calls it append-only but read is allowed for the app) and on
-- log_chain_anchors (read is allowed for verification/cache inspection;
-- only WRITES come from the anchor committer per ADR-0010).
GRANT SELECT ON TABLE
  "workspace_membership_events",
  "log_chain_anchors"
TO secure_core_app;

-- Defense-in-depth: explicitly REVOKE UPDATE/DELETE on the §12.1.2 set.
-- (GRANT INSERT alone implies the others are absent, but PostgreSQL allows
-- prior grants to accumulate; this REVOKE makes the closure explicit and
-- survives a future GRANT misstep.)
REVOKE UPDATE, DELETE ON TABLE
  "audit_events",
  "provenance_events",
  "operator_events",
  "log_chain_anchors",
  "workspace_membership_events"
FROM secure_core_app;

REVOKE SELECT ON TABLE
  "audit_events",
  "provenance_events",
  "operator_events"
FROM secure_core_app;

REVOKE INSERT, UPDATE, DELETE ON TABLE "log_chain_anchors" FROM secure_core_app;

-- ---------------------------------------------------------------------------
-- 5. secure_core_audit_read — SELECT-only on audit/provenance/operator/anchor.
--
-- §12.1.3 Option A: the audit-read endpoint opens a separate DB role only
-- AFTER `audit:read` (or platform capability) is verified; the role's grants
-- alone do NOT authorize a request.
-- ---------------------------------------------------------------------------

GRANT SELECT ON TABLE
  "audit_events",
  "provenance_events",
  "operator_events",
  "log_chain_anchors"
TO secure_core_audit_read;

-- Belt-and-suspenders: forbid mutation on the audit-read role.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  "audit_events",
  "provenance_events",
  "operator_events",
  "log_chain_anchors"
FROM secure_core_audit_read;

-- ---------------------------------------------------------------------------
-- 6. secure_core_anchor_writer — INSERT-only on log_chain_anchors.
--
-- §12.1.4: only the external-anchor-commitment process, with a distinct
-- credential, may insert anchor rows. ADR-0010 names this process the
-- "anchor committer".
-- ---------------------------------------------------------------------------

GRANT INSERT ON TABLE "log_chain_anchors" TO secure_core_anchor_writer;

REVOKE SELECT, UPDATE, DELETE ON TABLE "log_chain_anchors" FROM secure_core_anchor_writer;

-- ---------------------------------------------------------------------------
-- 7. The migrator role does NOT receive LOGIN here; whoever bootstraps the
--    DB grants login (or sets a password) at deploy time. Local dev hands
--    out login via `ALTER ROLE secure_core_migrator LOGIN PASSWORD '...'`.
-- ---------------------------------------------------------------------------

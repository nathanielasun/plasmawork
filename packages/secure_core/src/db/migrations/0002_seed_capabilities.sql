-- Phase 0.5 / Layer-1 / L1.8 — seed §13 suggested roles into `roles`.
--
-- v4 §13 lists nine "suggested roles". The `role_permissions` row set per
-- role is seeded by the next migration (0003_seed_role_permissions.sql).
--
-- Role UUIDs are deterministic UUIDv5s (namespace
-- 6f1c8a2e-9b3d-4e5f-8a0c-1d2e3f4a5b6c, name 'secure_core/role/<Name>') so
-- the IDs are stable across environments and re-runs are idempotent via
-- ON CONFLICT DO NOTHING.
--
-- Capabilities themselves are NOT a separate table in v4 §11; they live as
-- a TypeScript literal-union in `src/config/capabilities.ts` and as TEXT
-- column values in `role_permissions`. Application code calls
-- `isCapability(value)` at trust boundaries.

INSERT INTO "roles" ("id", "name", "description") VALUES
  ('0f3a0db6-7d71-5543-a1d0-ee13efa1eb60', 'Viewer',
   'Read-only access to capsules, tools, artifacts, docs.'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'Researcher',
   'Create / fork / update capsules, run local jobs, request approvals.'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'ModuleDeveloper',
   'Researcher plus create / update candidate tools and request promotion.'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'Reviewer',
   'Researcher plus approve validation / module promotion and read audit log.'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'ComputeManager',
   'Researcher plus approve expensive runs and HPC submissions.'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'WorkspaceAdmin',
   'ModuleDeveloper plus manage members, settings, and workspace deletion.'),
  ('0445ee2d-c744-5e78-92bc-c9046cf5731a', 'PlatformAuditor',
   'Cross-workspace audit read only.'),
  ('b277eb98-7ede-5a4b-97e4-1983f7e3f4e0', 'IncidentInvestigator',
   'PlatformAuditor plus cross-workspace security investigation.'),
  ('9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad', 'IncidentRemediator',
   'IncidentInvestigator plus session revocation and user disable.')
ON CONFLICT (id) DO NOTHING;

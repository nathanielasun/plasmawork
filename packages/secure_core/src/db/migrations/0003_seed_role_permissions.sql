-- Phase 0.5 / Layer-1 / L1.8 — seed `role_permissions` per v4 §13.
--
-- Every (role_id, capability) pair lands here. Capability values must match
-- the literal-union in `src/config/capabilities.ts`. The set is identical to
-- the one in the L1.1 module; if a capability is added there, both must be
-- updated in lockstep — no runtime-discovered capabilities.
--
-- ON CONFLICT DO NOTHING makes re-runs safe.
--
-- Role UUIDs match `0002_seed_capabilities.sql`:
--   0f3a0db6-… Viewer
--   c05d93f2-… Researcher
--   ff0a1c18-… ModuleDeveloper
--   ba6938c5-… Reviewer
--   94fa63af-… ComputeManager
--   5b807f69-… WorkspaceAdmin
--   0445ee2d-… PlatformAuditor
--   b277eb98-… IncidentInvestigator
--   9fd675cb-… IncidentRemediator

-- ---------------------------------------------------------------------------
-- Viewer: read-only.
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "capability") VALUES
  ('0f3a0db6-7d71-5543-a1d0-ee13efa1eb60', 'workspace:view'),
  ('0f3a0db6-7d71-5543-a1d0-ee13efa1eb60', 'capsule:read'),
  ('0f3a0db6-7d71-5543-a1d0-ee13efa1eb60', 'tool:read'),
  ('0f3a0db6-7d71-5543-a1d0-ee13efa1eb60', 'artifact:read')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Researcher: Viewer + create/fork/update capsules + run + approval requests
--             + provenance read.
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "capability") VALUES
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'workspace:view'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'capsule:read'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'tool:read'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'artifact:read'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'capsule:create'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'capsule:update'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'capsule:fork'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'run:create'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'run:cancel'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'approval:request'),
  ('c05d93f2-b54a-5fcc-9db2-4f08c9f4b09a', 'provenance:read')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- ModuleDeveloper: Researcher + create/update tools + request promotion.
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "capability") VALUES
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'workspace:view'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'capsule:read'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'tool:read'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'artifact:read'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'capsule:create'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'capsule:update'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'capsule:fork'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'run:create'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'run:cancel'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'approval:request'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'provenance:read'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'tool:create'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'tool:update'),
  ('ff0a1c18-7f84-56c9-abf5-8fe09b7f96eb', 'tool:request_promotion')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Reviewer: Researcher + approve module promotion + audit:read.
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "capability") VALUES
  ('ba6938c5-0909-558c-8318-1635553d2391', 'workspace:view'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'capsule:read'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'tool:read'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'artifact:read'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'capsule:create'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'capsule:update'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'capsule:fork'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'run:create'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'run:cancel'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'approval:request'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'provenance:read'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'tool:approve_promotion'),
  ('ba6938c5-0909-558c-8318-1635553d2391', 'audit:read')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- ComputeManager: Researcher + approve expensive run + approve HPC.
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "capability") VALUES
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'workspace:view'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'capsule:read'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'tool:read'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'artifact:read'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'capsule:create'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'capsule:update'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'capsule:fork'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'run:create'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'run:cancel'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'approval:request'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'provenance:read'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'run:approve_expensive'),
  ('94fa63af-4c12-5d92-9f36-7e303015af56', 'run:approve_hpc')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- WorkspaceAdmin: ModuleDeveloper + manage members/settings/delete +
--                 deprecate tools + delete capsules.
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "capability") VALUES
  ('5b807f69-df63-5054-a96a-490c9668a567', 'workspace:view'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'capsule:read'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'tool:read'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'artifact:read'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'capsule:create'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'capsule:update'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'capsule:fork'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'run:create'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'run:cancel'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'approval:request'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'provenance:read'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'tool:create'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'tool:update'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'tool:request_promotion'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'workspace:manage_members'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'workspace:manage_settings'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'workspace:delete'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'tool:deprecate'),
  ('5b807f69-df63-5054-a96a-490c9668a567', 'capsule:delete')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- PlatformAuditor: cross-workspace audit read ONLY (no workspace caps).
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "capability") VALUES
  ('0445ee2d-c744-5e78-92bc-c9046cf5731a', 'platform:audit_read')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- IncidentInvestigator: PlatformAuditor + incident_investigate.
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "capability") VALUES
  ('b277eb98-7ede-5a4b-97e4-1983f7e3f4e0', 'platform:audit_read'),
  ('b277eb98-7ede-5a4b-97e4-1983f7e3f4e0', 'platform:incident_investigate')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- IncidentRemediator: IncidentInvestigator + incident_remediate +
--                     session:revoke + user:disable.
-- ---------------------------------------------------------------------------
INSERT INTO "role_permissions" ("role_id", "capability") VALUES
  ('9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad', 'platform:audit_read'),
  ('9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad', 'platform:incident_investigate'),
  ('9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad', 'platform:incident_remediate'),
  ('9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad', 'session:revoke'),
  ('9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad', 'user:disable')
ON CONFLICT DO NOTHING;

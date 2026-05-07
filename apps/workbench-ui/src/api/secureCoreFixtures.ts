/**
 * Deterministic secure-core fixtures for local UI development.
 *
 * These are presentation fixtures only. The Security page still attempts the
 * real secure-core endpoints first and labels fixture mode explicitly when the
 * backend is unavailable.
 */
import type {
  CurrentSessionResponse,
  SecureCoreRouteContract,
  SecurityDashboardResponse,
} from "./secureCoreClient";

const now = "2026-05-07T15:00:00.000Z";

export const SECURE_CORE_UI_ROUTES: readonly SecureCoreRouteContract[] = [
  {
    id: "auth.session",
    method: "GET",
    path: "/auth/session",
    auth: "session",
    csrf: "none",
    approval: "none",
    readiness: "ready",
    uiSurface: "app_shell",
    notes: "Server-derived identity, assurance, memberships, and capabilities.",
  },
  {
    id: "security.dashboard",
    method: "GET",
    path: "/operator/security-dashboard",
    auth: "operator_audit_read",
    csrf: "none",
    approval: "none",
    readiness: "ready",
    uiSurface: "security_operations",
    notes: "AAL2/AAL3 operator read path for audit health and abuse spikes.",
  },
  {
    id: "operator.audit_events",
    method: "GET",
    path: "/operator/audit-events",
    auth: "operator_audit_read",
    csrf: "none",
    approval: "none",
    readiness: "ready",
    uiSurface: "operator_access",
    notes: "Cross-workspace operator audit read; emits an operator event.",
  },
  {
    id: "operator.investigate",
    method: "POST",
    path: "/operator/incident/:workspaceId/investigate",
    auth: "operator_incident_investigate",
    csrf: "session",
    approval: "header_token",
    readiness: "ready",
    uiSurface: "operator_access",
    notes: "Requires step-up and approval before incident investigation.",
  },
  {
    id: "operator.remediate",
    method: "POST",
    path: "/operator/incident/:workspaceId/remediate",
    auth: "operator_incident_remediate",
    csrf: "session",
    approval: "header_token",
    readiness: "fail_closed",
    uiSurface: "operator_access",
    notes: "Backend logs and refuses until real remediation side effects exist.",
  },
  {
    id: "runs.create",
    method: "POST",
    path: "/workspaces/:workspaceId/capsules/:capsuleId/runs",
    auth: "session",
    csrf: "session",
    approval: "none",
    readiness: "ready",
    uiSurface: "runs",
    notes: "Workspace-scoped run creation with named rate limiting.",
  },
  {
    id: "artifacts.export",
    method: "POST",
    path: "/workspaces/:workspaceId/artifacts/:artifactId/export",
    auth: "session",
    csrf: "session",
    approval: "header_token",
    readiness: "ready",
    uiSurface: "artifacts",
    notes: "High-risk export; approval token must be supplied in a header.",
  },
  {
    id: "worker.upload",
    method: "POST",
    path: "/api/workers/uploads",
    auth: "worker_token",
    csrf: "none",
    approval: "none",
    readiness: "deployment_gated",
    uiSurface: "worker_internal",
    notes: "Internal worker route; not a browser upload surface.",
  },
];

export const secureCoreSessionFixture: CurrentSessionResponse = {
  user_id: "user_fixture_operator",
  session_id: "sess_fixture_readonly",
  actor_type: "human",
  assurance_level: "aal2",
  memberships: [
    {
      workspace_id: "workspace_fixture_shocktube",
      workspace_name: "ShockTube Studies",
      role_id: "role_platform_operator",
      role_name: "Platform Operator",
      capabilities: [
        "workspace:view",
        "capsule:read",
        "run:create",
        "artifact:read",
        "audit:read",
        "provenance:read",
        "platform:audit_read",
        "platform:incident_investigate",
      ],
    },
  ],
};

export const secureCoreDashboardFixture: SecurityDashboardResponse = {
  generatedAt: now,
  status: "warning",
  chains: [
    {
      logType: "audit",
      ok: true,
      rowsVerified: 1842,
      tipHash: "sha256:fixture-audit-tip",
      latestAnchorCommittedAt: "2026-05-07T14:56:00.000Z",
      latestExternalAnchorUri: "worm://fixture/audit/2026-05-07T1456Z",
      anchorLagMs: 240_000,
      status: "healthy",
    },
    {
      logType: "provenance",
      ok: true,
      rowsVerified: 731,
      tipHash: "sha256:fixture-provenance-tip",
      latestAnchorCommittedAt: "2026-05-07T14:47:00.000Z",
      latestExternalAnchorUri: "worm://fixture/provenance/2026-05-07T1447Z",
      anchorLagMs: 780_000,
      status: "warning",
    },
    {
      logType: "operator",
      ok: true,
      rowsVerified: 118,
      tipHash: "sha256:fixture-operator-tip",
      latestAnchorCommittedAt: "2026-05-07T14:59:00.000Z",
      latestExternalAnchorUri: "worm://fixture/operator/2026-05-07T1459Z",
      anchorLagMs: 60_000,
      status: "healthy",
    },
  ],
  deniedAccess: [
    {
      name: "permission_denied",
      count: 7,
      windowMs: 300_000,
      status: "healthy",
    },
    {
      name: "csrf_failed",
      count: 11,
      windowMs: 300_000,
      status: "warning",
    },
  ],
  sandboxViolations: [
    {
      name: "sandbox_violation",
      count: 0,
      windowMs: 300_000,
      status: "healthy",
    },
  ],
};

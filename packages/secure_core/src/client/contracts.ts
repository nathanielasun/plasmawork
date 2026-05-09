/**
 * Frontend-facing secure-core contracts.
 *
 * This file is intentionally data-only: browser code may import these
 * types and constants without pulling in Fastify, Drizzle, postgres,
 * secrets providers, or server-only services.
 */

import type { ErrorEnvelope } from "../errors/shapes.js";
import type { SecurityDashboardSnapshot } from "../security/dashboard.js";
import type { ActorType } from "../middleware/types.js";
import type { Capability } from "../config/capabilities.js";

export type SecureCoreErrorEnvelope = ErrorEnvelope;

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type FrontendAuthMode =
  | "none"
  | "session"
  | "operator_audit_read"
  | "operator_incident_investigate"
  | "operator_incident_remediate"
  | "worker_token";
export type FrontendCsrfMode = "none" | "origin" | "session";
export type FrontendApprovalMode = "none" | "header_token";
export type FrontendReadiness =
  | "ready"
  | "fail_closed"
  | "deployment_gated"
  | "planned";

export interface SecureCoreRouteContract {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly auth: FrontendAuthMode;
  readonly csrf: FrontendCsrfMode;
  readonly approval: FrontendApprovalMode;
  readonly readiness: FrontendReadiness;
  readonly uiSurface: string;
  readonly notes: string;
}

export interface AcceptedResponse {
  readonly status: "accepted";
  readonly message: string;
}

export interface OkResponse {
  readonly status: "ok";
}

export interface WorkerTokenIssuedResponse {
  readonly token: string;
  readonly expires_at: string;
}

export interface CurrentSessionMembership {
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly role_id: string;
  readonly role_name: string;
  readonly capabilities: readonly Capability[];
}

/**
 * Contract for the session-introspection route. Frontend code should
 * use this shape for mocks and app-shell capability gating.
 */
export interface CurrentSessionResponse {
  readonly user_id: string;
  readonly session_id: string;
  readonly actor_type: Exclude<ActorType, "unauthenticated">;
  readonly assurance_level: "aal1" | "aal2" | "aal3";
  readonly memberships: readonly CurrentSessionMembership[];
}

export type SecurityDashboardResponse = SecurityDashboardSnapshot;

/**
 * Contract for the login REQUEST body. Phase 0.5 auth gateway
 * (2026-05-09) made username the canonical login identifier; email is
 * supplementary metadata stored on the user row but never accepted as
 * a login factor.
 */
export interface LoginRequestBody {
  readonly username: string;
  readonly password: string;
}

/**
 * Contract for the login response body. The frontend reads `csrf_token`
 * from this body and caches it in memory; the SPA echoes it as
 * `X-CSRF-Token` on every state-changing request. The raw session
 * token is NEVER returned in the body — it lives only in the HttpOnly
 * `secure_session` cookie. The same shape is returned by the recovery
 * → session bridge (password-reset/consume + email-verify/consume).
 */
export interface LoginResponseBody {
  readonly user_id: string;
  readonly session_id: string;
  readonly assurance_level: "aal1" | "aal2" | "aal3";
  readonly csrf_token: string;
  readonly expires_at: string;
}

export const SECURE_CORE_FRONTEND_ROUTES = [
  {
    id: "auth.login",
    method: "POST",
    path: "/auth/login",
    auth: "none",
    csrf: "origin",
    approval: "none",
    readiness: "ready",
    uiSurface: "auth",
    notes:
      "Mints secure_session (HttpOnly) and csrf_token (non-HttpOnly) cookies; returns LoginResponseBody. Constant-time anti-enumeration on failure.",
  },
  {
    id: "auth.logout",
    method: "POST",
    path: "/auth/logout",
    auth: "session",
    csrf: "session",
    approval: "none",
    readiness: "ready",
    uiSurface: "auth",
    notes:
      "Revokes the session and clears both cookies idempotently (returns 204 even if the revocation fails on an unknown error).",
  },
  {
    id: "auth.password_reset.request",
    method: "POST",
    path: "/auth/password-reset/request",
    auth: "none",
    csrf: "origin",
    approval: "none",
    readiness: "ready",
    uiSurface: "auth",
    notes: "Anti-enumeration 202 response.",
  },
  {
    id: "auth.password_reset.consume",
    method: "POST",
    path: "/auth/password-reset/consume",
    auth: "none",
    csrf: "origin",
    approval: "none",
    readiness: "ready",
    uiSurface: "auth",
    notes:
      "Consumes a single-use reset token AND mints a fresh aal2 session (LoginResponseBody + cookies). Recovery → session bridge.",
  },
  {
    id: "auth.email_verify.request",
    method: "POST",
    path: "/auth/email-verify/request",
    auth: "none",
    csrf: "origin",
    approval: "none",
    readiness: "ready",
    uiSurface: "auth",
    notes: "Anti-enumeration 202 response.",
  },
  {
    id: "auth.email_verify.consume",
    method: "POST",
    path: "/auth/email-verify/consume",
    auth: "none",
    csrf: "origin",
    approval: "none",
    readiness: "ready",
    uiSurface: "auth",
    notes:
      "Consumes a single-use verification token AND mints a fresh aal1 session (LoginResponseBody + cookies). Recovery → session bridge.",
  },
  {
    id: "auth.mfa_recovery",
    method: "POST",
    path: "/auth/mfa-recovery",
    auth: "none",
    csrf: "origin",
    approval: "none",
    readiness: "fail_closed",
    uiSurface: "auth",
    notes: "Returns pending operator-review response; no automatic unlock.",
  },
  {
    id: "auth.session",
    method: "GET",
    path: "/auth/session",
    auth: "session",
    csrf: "none",
    approval: "none",
    readiness: "ready",
    uiSurface: "app_shell",
    notes: "Server-derived identity, assurance, live memberships, and capabilities.",
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
    notes: "Requires AAL2/AAL3 step-up and platform:audit_read.",
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
    notes: "Cross-workspace audit read; operator event emitted.",
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
    notes: "Requires step-up before approval token consumption.",
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
    notes: "Logs attempt and refuses until real side effects are implemented.",
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
    notes: "Uses workspace membership/capability and optional named rate limit.",
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
    notes: "High-risk export; X-Approval-Token only.",
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
    notes: "Internal worker route; not a browser UI upload endpoint.",
  },
] as const satisfies readonly SecureCoreRouteContract[];

export type SecureCoreFrontendRouteId =
  (typeof SECURE_CORE_FRONTEND_ROUTES)[number]["id"];

export function frontendReadyRoutes(): readonly SecureCoreRouteContract[] {
  return SECURE_CORE_FRONTEND_ROUTES.filter(
    (route) => route.readiness === "ready",
  );
}

export function frontendDisabledRoutes(): readonly SecureCoreRouteContract[] {
  return SECURE_CORE_FRONTEND_ROUTES.filter(
    (route) => route.readiness !== "ready",
  );
}

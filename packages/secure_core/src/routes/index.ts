/**
 * Routes barrel — Phase 0.5 Layer 4.
 *
 * Each route plugin is a Fastify plugin that takes a service +
 * middleware bundle and registers the v4 §10.2 endpoint subset for
 * its resource. Apps wire them together at startup with the
 * already-constructed L2 middleware deps.
 */

export {
  healthRoutes,
  MetricsRegistry,
  type HealthRoutesOptions,
} from "./health.js";

export {
  workspaceRoutes,
  type WorkspaceRoutesOptions,
  type WorkspaceRoutesMiddleware,
} from "./workspaces.js";

export {
  capsuleRoutes,
  type CapsuleRoutesOptions,
  type CapsuleRoutesMiddleware,
} from "./capsules.js";

export {
  auditEventsRoutes,
  type AuditEventsRoutesOptions,
  type AuditEventsRoutesMiddleware,
} from "./auditEvents.js";

export {
  toolRoutes,
  type ToolRoutesOptions,
  type ToolRoutesMiddleware,
} from "./tools.js";

export {
  approvalRoutes,
  type ApprovalRoutesOptions,
  type ApprovalRoutesMiddleware,
} from "./approvals.js";

export {
  bootstrapRoutes,
  type BootstrapRoutesOptions,
  type BootstrapRoutesMiddleware,
} from "./bootstrap.js";

export {
  authRoutes,
  type AuthRoutesOptions,
  type AuthRoutesMiddleware,
  REQUEST_EMAIL_SCHEMA,
  PASSWORD_RESET_CONSUME_SCHEMA,
  EMAIL_VERIFY_CONSUME_SCHEMA,
  MFA_RECOVERY_SCHEMA,
} from "./auth.js";

export {
  loginRoutes,
  type LoginRoutesOptions,
  type LoginRoutesMiddleware,
  type LoginResponseBody,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  LOGIN_RESPONSE_SCHEMA,
  LOGIN_SCHEMA,
  LOGOUT_SCHEMA,
} from "./login.js";

export {
  sessionRoutes,
  CURRENT_SESSION_RESPONSE_SCHEMA,
  type SessionRoutesOptions,
  type SessionRoutesMiddleware,
} from "./session.js";

export {
  operatorRoutes,
  type OperatorRoutesOptions,
  type OperatorRoutesMiddleware,
} from "./operator.js";

export {
  securityDashboardRoutes,
  type SecurityDashboardRoutesOptions,
  type SecurityDashboardRoutesMiddleware,
} from "./securityDashboard.js";

export {
  runRoutes,
  type RunRoutesOptions,
  type RunRoutesMiddleware,
} from "./runs.js";

export {
  artifactRoutes,
  type ArtifactRoutesOptions,
  type ArtifactRoutesMiddleware,
} from "./artifacts.js";

// L4.11 — worker token issuance (orchestrator-only). Lives in
// `src/workers/` rather than `src/routes/` because it shares the
// L3.8 issuer + the L3.9 upload route's worker-internal namespace,
// but is re-exported here so the routes barrel is the single import
// surface for app composition.
export {
  workerTokenRoute,
  type WorkerTokenRouteOptions,
  type WorkerTokenRouteMiddleware,
  type WorkerTokenRunRecord,
  type RunRecordSource,
} from "../workers/tokenRoute.js";

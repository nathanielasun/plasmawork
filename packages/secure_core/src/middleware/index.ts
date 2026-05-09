/**
 * Middleware barrel — Phase 0.5 Layer 2.
 *
 * Re-exports the §6.2 middleware suite so route plugins can import
 * from one path and `composeMiddleware()` operates on a uniform shape.
 */

export {
  composeMiddleware,
  MIDDLEWARE_ORDER,
  MiddlewareOrderError,
  type MiddlewareName,
  type NamedMiddleware,
} from "./compose.js";

export { requireRequestId } from "./requireRequestId.js";
export {
  enforceRateLimit,
  InMemoryRateLimitStore,
  type EnforceRateLimitDeps,
  type RateLimitBucket,
  type RateLimitKeyExtractor,
  type RateLimitStore,
} from "./enforceRateLimit.js";
export { requireAuth, type RequireAuthDeps } from "./requireAuth.js";
export {
  enforceCsrfForStateChange,
  type EnforceCsrfDeps,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "./enforceCsrfForStateChange.js";
export { validateInputSchema } from "./validateInputSchema.js";
export { attachAuditActor } from "./attachAuditActor.js";
export {
  loadWorkspace,
  enforceUniformNotFound,
  type LoadWorkspaceDeps,
} from "./loadWorkspace.js";
export {
  loadWorkspaceBySlug,
  type LoadWorkspaceBySlugDeps,
} from "./loadWorkspaceBySlug.js";
export {
  requireWorkspaceMembership,
  type RequireMembershipDeps,
} from "./requireWorkspaceMembership.js";
export {
  requireCapability,
  type RequireCapabilityDeps,
} from "./requireCapability.js";
export {
  requirePlatformCapability,
  type RequirePlatformCapabilityDeps,
} from "./requirePlatformCapability.js";
export {
  withOperatorStepUp,
  type WithOperatorStepUpOptions,
} from "./operatorStepUp.js";
export {
  enforceObjectWorkspaceScope,
  type EnforceObjectScopeDeps,
  type ObjectScopeKind,
} from "./enforceObjectWorkspaceScope.js";
export {
  requireApprovalIfHighRisk,
  APPROVAL_TOKEN_HEADER,
  type RequireApprovalDeps,
  type ApprovalConsumeResult,
} from "./requireApprovalIfHighRisk.js";

export type {
  ActorType,
  AuthContext,
  AuditContext,
  WorkspaceContext,
  MembershipContext,
} from "./types.js";

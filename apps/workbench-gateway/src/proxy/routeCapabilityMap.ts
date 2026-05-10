/**
 * Per-route capability map for proxied /api/* endpoints — Phase α
 * post-audit hardening (2026-05-10).
 *
 * Audit caught a gap: the proxy auth chain runs ``requireAuth →
 * loadWorkspaceBySlug → requireWorkspaceMembership → enforceCsrf →
 * attachAuditActor``. It does NOT enforce per-route capabilities, so
 * a regular workspace member (e.g. ``Researcher`` role with only
 * ``capsule:read`` / ``run:create``) can still call mutation
 * endpoints like ``/api/tools/import`` or
 * ``/api/tool-authoring/drafts`` because those FastAPI handlers had
 * no role check of their own. UI capability gating (hiding the
 * Promote button etc.) was not a security boundary.
 *
 * The fix: a centralized map of (method, path-regex) → required
 * capabilities that the proxy plugin's auth chain consults before
 * forwarding. Any request whose path matches an entry MUST carry the
 * required workspace and/or platform capabilities; otherwise the
 * proxy refuses with 403 BEFORE the FastAPI handler runs. Any
 * unmapped state-changing request fails closed instead of falling
 * back to membership-only access.
 *
 * The path is the ORIGINAL request URL (slug-prefixed); the regexes
 * match against ``/api/{slug}/{rest}``. They use Fastify's existing
 * URL routing, so a slug containing ``[A-Za-z0-9_-]`` is the only
 * variability.
 *
 * Idempotent (GET / HEAD / OPTIONS) requests are NOT in this map by
 * default — workspace membership alone gates read access. Mutating
 * methods that touch the registry / authoring / approvals surfaces
 * are the protected ones.
 */
import type { Capability } from "../../../../packages/secure_core/src/config/capabilities.js";

type ProxyMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteCapabilityRequirement {
  readonly workspaceAllOf?: ReadonlyArray<Capability>;
  readonly workspaceAnyOf?: ReadonlyArray<Capability>;
  readonly platformAllOf?: ReadonlyArray<Capability>;
}

export interface RouteCapabilityRule {
  /** HTTP method this rule applies to. */
  readonly method: ProxyMethod;
  /**
   * Regex matching the URL path. Anchored at the start; un-anchored
   * at the end so trailing path segments are tolerated. Uses the
   * URL path POST-prefix (``/api/{slug}/...``) — that's what the
   * Fastify request reports BEFORE the proxy's preRewrite strips
   * the slug.
   */
  readonly pattern: RegExp;
  /** Workspace and/or platform capabilities required before proxy forwarding. */
  readonly requirement: RouteCapabilityRequirement;
}

/**
 * The current map. Add new entries as new mutating routes ship.
 * The convention checker pins the existence of this list so a future
 * commit that adds a mutating route without an entry surfaces as a
 * gate failure rather than a silent capability bypass.
 */
export const PROXY_ROUTE_CAPABILITIES: ReadonlyArray<RouteCapabilityRule> = [
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/examples\/[^\/]+\/run\b/,
    requirement: { workspaceAllOf: ["run:create"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/runs\b/,
    requirement: { workspaceAllOf: ["run:create"] },
  },
  // Tool import — requires the active workspace's tool:create.
  // Regular workspace members (Viewer / Researcher) cannot import
  // tools into their workspace; that's WorkspaceAdmin work.
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/import\b/,
    requirement: { workspaceAllOf: ["tool:create"] },
  },
  // Cross-workspace promotion request — requires
  // tool:request_promotion (in WorkspaceAdmin).
  {
    method: "POST",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/promote\b/,
    requirement: { workspaceAllOf: ["tool:request_promotion"] },
  },
  // Tool execution / status / export — workspace-admin gated. A
  // regular Researcher can READ tools (GET /api/tools) but cannot
  // mutate tool state.
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/status\b/,
    requirement: { workspaceAllOf: ["tool:update"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/preview\b/,
    requirement: { workspaceAllOf: ["tool:read"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/runs\b/,
    requirement: { workspaceAllOf: ["tool:read", "run:create"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/run-tests\b/,
    requirement: { workspaceAllOf: ["tool:update"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/execute\b/,
    requirement: { workspaceAllOf: ["tool:read", "run:create"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/export\b/,
    requirement: { workspaceAllOf: ["tool:read"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/code-templates\b/,
    requirement: { workspaceAllOf: ["tool:create"] },
  },
  {
    method: "DELETE",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/code-templates\/[^\/]+\b/,
    requirement: { workspaceAllOf: ["tool:create"] },
  },
  // Tool draft authoring — full sandbox of mutations require
  // tool:create (the user is materially creating new tool code).
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/drafts\b/,
    requirement: { workspaceAllOf: ["tool:create"] },
  },
  {
    method: "PUT",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/drafts\/[^\/]+\/files\b/,
    requirement: { workspaceAllOf: ["tool:create"] },
  },
  {
    method: "DELETE",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/drafts\/[^\/]+\b/,
    requirement: { workspaceAllOf: ["tool:create"] },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/drafts\/[^\/]+\/(manifest|apply-code-template|preview|check|register|export)\b/,
    requirement: { workspaceAllOf: ["tool:create"] },
  },
  // Promotion approve / deny — platform admin only. Server-side
  // _require_role still enforces this; the proxy gate is the
  // first line of defense.
  {
    method: "POST",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-promotions\/[^\/]+\/(approve|deny)\b/,
    requirement: { platformAllOf: ["platform:incident_remediate"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/papers\/import\b/,
    requirement: { workspaceAllOf: ["capsule:update"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/papers\/[^\/]+\/edit\b/,
    requirement: { workspaceAllOf: ["capsule:update"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/proposals\b/,
    requirement: { workspaceAllOf: ["capsule:update"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/capsules\/[^\/]+\/codegen\b/,
    requirement: { workspaceAllOf: ["capsule:update"] },
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/capsules\/[^\/]+\/validate-run\b/,
    requirement: { workspaceAllOf: ["capsule:update"] },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/capsules\/[^\/]+\/user_edits\/.+/,
    requirement: { workspaceAllOf: ["capsule:update"] },
  },
  {
    method: "POST",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/autonomy\/(design|smoke|review|sweep)\/[^\/]+\b/,
    requirement: { workspaceAllOf: ["capsule:update"] },
  },
];

/**
 * Look up the required capabilities for a request, if any. A caller
 * that receives undefined for a state-changing method must fail
 * closed instead of forwarding.
 */
export function isProxyStateChangingMethod(method: string): method is ProxyMethod {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

export function findRequiredCapabilities(
  method: string,
  path: string,
): RouteCapabilityRequirement | undefined {
  const m = method.toUpperCase();
  for (const rule of PROXY_ROUTE_CAPABILITIES) {
    if (rule.method === m && rule.pattern.test(path)) {
      return rule.requirement;
    }
  }
  return undefined;
}

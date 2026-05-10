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
 * capability that the proxy plugin's auth chain consults before
 * forwarding. Any request whose path matches an entry MUST carry
 * the capability in ``req.membership.capabilities``; otherwise the
 * proxy refuses with 403 BEFORE the FastAPI handler runs.
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
  /** Capability the active membership MUST hold for this request. */
  readonly capability: Capability;
}

/**
 * The current map. Add new entries as new mutating routes ship.
 * The convention checker pins the existence of this list so a future
 * commit that adds a mutating route without an entry surfaces as a
 * gate failure rather than a silent capability bypass.
 */
export const PROXY_ROUTE_CAPABILITIES: ReadonlyArray<RouteCapabilityRule> = [
  // Tool import — requires the active workspace's tool:create.
  // Regular workspace members (Viewer / Researcher) cannot import
  // tools into their workspace; that's WorkspaceAdmin work.
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/import\b/,
    capability: "tool:create",
  },
  // Cross-workspace promotion request — requires
  // tool:request_promotion (in WorkspaceAdmin).
  {
    method: "POST",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/promote\b/,
    capability: "tool:request_promotion",
  },
  // Tool execution / status / export — workspace-admin gated. A
  // regular Researcher can READ tools (GET /api/tools) but cannot
  // mutate tool state.
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/status\b/,
    capability: "tool:update",
  },
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tools\/[A-Za-z0-9_-]+\/export\b/,
    capability: "tool:read",
  },
  // Tool draft authoring — full sandbox of mutations require
  // tool:create (the user is materially creating new tool code).
  {
    method: "POST",
    pattern: /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/drafts\b/,
    capability: "tool:create",
  },
  {
    method: "PUT",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/drafts\/[^\/]+\/files\b/,
    capability: "tool:create",
  },
  {
    method: "DELETE",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/drafts\/[^\/]+\b/,
    capability: "tool:create",
  },
  {
    method: "POST",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-authoring\/drafts\/[^\/]+\/register\b/,
    capability: "tool:create",
  },
  // Promotion approve / deny — platform admin only. Server-side
  // _require_role still enforces this; the proxy gate is the
  // first line of defense.
  {
    method: "POST",
    pattern:
      /^\/api\/[A-Za-z0-9_-]{3,64}\/tool-promotions\/[^\/]+\/(approve|deny)\b/,
    capability: "platform:incident_remediate",
  },
];

/**
 * Look up the required capability for a request, if any. Returns
 * undefined when the route is unmapped — those go through with the
 * default workspace-membership gate.
 */
export function findRequiredCapability(
  method: string,
  path: string,
): Capability | undefined {
  const m = method.toUpperCase();
  for (const rule of PROXY_ROUTE_CAPABILITIES) {
    if (rule.method === m && rule.pattern.test(path)) {
      return rule.capability;
    }
  }
  return undefined;
}

/**
 * Workbench proxy plugin — Phase 0.5 / Phase E2-rest (2026-05-09).
 *
 * Mounts ``@fastify/http-proxy`` at the ``/api/:slug/*`` URL pattern
 * and forwards authenticated, workspace-authorized requests to the
 * loopback-bound FastAPI workbench. The 7 ``X-Workbench-*`` headers
 * are signed by the gateway and verified by the FastAPI middleware
 * (``packages/core/src/simworkbench/api/auth_middleware.py``).
 *
 * Defenses composed in this commit:
 *   - cookie-session ``requireAuth`` (any unauthenticated caller
 *     never reaches the proxy);
 *   - ``loadWorkspaceBySlug`` (resolves the URL slug to a real
 *     workspace UUID; non-existent / soft-deleted workspaces collapse
 *     into the §4.4 uniform 404);
 *   - ``requireWorkspaceMembership`` (membership lookup; non-members
 *     hit the same 404, never see the workspace exists);
 *   - inbound ``X-Workbench-*`` headers stripped (defense vs. client
 *     spoofing the handoff);
 *   - HMAC sign with ``WORKBENCH_GATEWAY_HANDOFF_SECRET`` (prevents
 *     same-host process spoofing if the operator forgets to bind
 *     loopback);
 *   - real workspace_id + role list in the handoff payload (no
 *     synthetic placeholders any more).
 *
 * What lands here that was DELIBERATELY missing from E2-min:
 *   - workspace_id + roles use the gateway's authorized membership,
 *     not a SHA-256-derived placeholder. E2-min shipped a proxy that
 *     authenticated users could point at any workspace slug they
 *     liked because no membership check ran; this commit closes that
 *     hole.
 *   - state-changing methods are now CSRF-checked at the gateway
 *     boundary via ``enforceCsrfForStateChange`` from secure_core.
 *
 * Slug → URL mapping for forwarding:
 *   - The gateway's URL pattern is ``/api/:slug/{rest}``. Today the
 *     FastAPI workbench has flat ``/api/{rest}`` routes (not yet
 *     slug-prefixed; that's Phase E5). The proxy strips the slug from
 *     the forwarded URL via ``preRewrite`` so today's flat FastAPI
 *     routes still match. When E5 introduces ``/api/{slug}/{rest}``
 *     routes, the strip becomes a no-op and ``slug_prefixed_paths``
 *     can be turned on at the FastAPI side.
 */
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fastifyHttpProxy from "@fastify/http-proxy";

import {
  HANDOFF_HEADERS,
  HANDOFF_HEADER_NAMES,
  signHandoffPayload,
  type HandoffPayload,
} from "./handoffSigner.js";
import {
  findRequiredCapabilities,
  isProxyStateChangingMethod,
  type RouteCapabilityRequirement,
} from "./routeCapabilityMap.js";
import type { MiddlewareHandler } from "../../../../packages/secure_core/src/middleware/compose.js";
import { PermissionDeniedError } from "../../../../packages/secure_core/src/errors/shapes.js";
import type { Capability } from "../../../../packages/secure_core/src/config/capabilities.js";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Computed in the proxy preHandler chain; consumed in
     * ``replyOptions.rewriteRequestHeaders``. Per-request scratch slot
     * — never read outside the proxy plugin.
     */
    workbenchHandoff?: {
      readonly payload: HandoffPayload;
      readonly signatureHex: string;
    };
  }
}

export interface WorkbenchProxyOptions {
  /** Loopback URL of the FastAPI backend (e.g. ``http://127.0.0.1:8000``). */
  readonly upstreamUrl: string;
  /** HMAC key shared with the FastAPI middleware. */
  readonly handoffSecret: string;
  /**
   * Authentication chain run BEFORE the proxy forwards. The host's
   * ``buildGatewayMiddleware`` factory composes this list in §6.2
   * order:
   *   requireAuth → loadWorkspaceBySlug → requireWorkspaceMembership
   *     → enforceCsrfForStateChange → attachAuditActor
   * Tests can pass stub handlers that pre-populate ``req.auth`` /
   * ``req.workspace`` / ``req.membership`` directly.
   */
  readonly authChain: ReadonlyArray<MiddlewareHandler>;
  /**
   * Async lookup of platform-tier roles a user holds across ANY
   * workspace membership. Audit fix (2026-05-10): platform roles
   * (IncidentRemediator, etc.) are anchored at user-level — v4 §13.2
   * — but the active workspace might not be where the role lives
   * (the seeded admin's IncidentRemediator role is in ``_platform``,
   * which the workspace switcher filters out). Without this seam,
   * the FastAPI ``_require_role`` checks against
   * ``req.membership.roleName`` only and refuses the platform admin's
   * own approval requests.
   *
   * The seam returns the union of platform-tier role names across
   * every membership; the handoff signer appends them to the active
   * workspace's role list so FastAPI sees both.
   *
   * Tests can pass a stub that returns ``[]``; production wires a DB
   * query against the user's full membership set.
   */
  readonly platformRolesFor?: (userId: string) => Promise<readonly string[]>;
  /**
   * Async lookup of platform-tier capabilities across every live
   * membership. Route authorization uses this for `platform:*`
   * requirements because `_platform` is not an active workspace.
   */
  readonly platformCapabilitiesFor?: (
    userId: string,
  ) => Promise<readonly Capability[]>;
  /** Optional clock seam — defaults to `Date.now`. Tests inject a fixed clock. */
  readonly now?: () => number;
}

/**
 * Strip any inbound ``X-Workbench-*`` header. Defense against a
 * client that pre-sets handoff headers hoping to slip past the
 * gateway. Runs BEFORE the handoff payload is computed so a hostile
 * pre-set can't influence the payload either.
 */
export function stripInboundHandoffHeaders(req: FastifyRequest): void {
  for (const name of HANDOFF_HEADER_NAMES) {
    delete req.headers[name];
  }
}

export function rewriteWorkbenchProxyUrl(url: string): string {
  return url.replace(/^\/api\/[A-Za-z0-9_-]{3,64}(?=\/|$|\?)/, "/api");
}

export function rewriteWorkbenchProxyHeaders(
  req: FastifyRequest,
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const handoff = req.workbenchHandoff;
  if (handoff === undefined) {
    // The preHandler chain refused to run; @fastify/http-proxy
    // shouldn't reach this branch in a normal request, but if it did
    // the missing handoff lets FastAPI 401 the request.
    return headers;
  }
  const { payload, signatureHex } = handoff;
  return {
    ...headers,
    [HANDOFF_HEADERS.USER_ID]: payload.userId,
    [HANDOFF_HEADERS.WORKSPACE_ID]: payload.workspaceId,
    [HANDOFF_HEADERS.WORKSPACE_SLUG]: payload.workspaceSlug,
    [HANDOFF_HEADERS.ROLES]: [...payload.roles].sort().join(","),
    [HANDOFF_HEADERS.REQUEST_ID]: payload.requestId,
    [HANDOFF_HEADERS.ISSUED_AT]: String(payload.issuedAtSec),
    [HANDOFF_HEADERS.SIGNATURE]: signatureHex,
  };
}

/**
 * Build the handoff payload from `req.auth` + `req.workspace` +
 * `req.membership`, compute the HMAC signature, and stash both on
 * ``req.workbenchHandoff``. Throws if any required field on `req` is
 * missing — the auth chain MUST have populated them upstream.
 *
 * The actual header emission happens in
 * ``replyOptions.rewriteRequestHeaders`` (configured below) because
 * @fastify/http-proxy forwards via reply.from; the rewriter is the
 * only seam that runs after the proxy has cloned the headers map.
 */
export function buildHandoffPreHandler(opts: {
  readonly handoffSecret: string;
  readonly now: () => number;
  readonly platformRolesFor?: (userId: string) => Promise<readonly string[]>;
  readonly platformCapabilitiesFor?: (
    userId: string,
  ) => Promise<readonly Capability[]>;
}): MiddlewareHandler {
  return async (req) => {
    if (req.auth === undefined) {
      throw new Error(
        "workbenchProxyPlugin: req.auth missing — preHandler must run requireAuth first.",
      );
    }
    if (req.workspace === undefined) {
      throw new Error(
        "workbenchProxyPlugin: req.workspace missing — preHandler must run loadWorkspaceBySlug first.",
      );
    }
    if (req.membership === undefined) {
      throw new Error(
        "workbenchProxyPlugin: req.membership missing — preHandler must run requireWorkspaceMembership first.",
      );
    }
    const requirement = findRequiredCapabilities(req.method, req.url);
    if (
      requirement === undefined &&
      isProxyStateChangingMethod(req.method)
    ) {
      throw new PermissionDeniedError(
        `Unmapped state-changing FastAPI route refused at gateway boundary: ${req.method} ${req.url}.`,
      );
    }

    // The active membership's role name is canonical; FastAPI keys
    // workspace-scoped role checks against this list. Audit fix
    // (2026-05-10): platform-tier roles (IncidentRemediator, etc.)
    // are user-level per v4 §13.2 — they live independent of any
    // active workspace. Aggregate them here so FastAPI's
    // ``_require_role`` sees the union.
    const baseRoles = [req.membership.roleName];
    let platformRoles: readonly string[] = [];
    let platformCapabilities: readonly Capability[] = [];
    let platformLookupFailed = false;
    if (opts.platformRolesFor !== undefined) {
      try {
        platformRoles = await opts.platformRolesFor(req.auth.userId);
      } catch {
        platformLookupFailed = true;
        platformRoles = [];
      }
    }
    if (opts.platformCapabilitiesFor !== undefined) {
      try {
        platformCapabilities = await opts.platformCapabilitiesFor(
          req.auth.userId,
        );
      } catch {
        platformLookupFailed = true;
        platformCapabilities = [];
      }
    }
    if (requirement !== undefined) {
      enforceRouteRequirement({
        requirement,
        workspaceCapabilities: req.membership.capabilities,
        platformCapabilities,
        platformLookupFailed,
        method: req.method,
        url: req.url,
      });
    }
    stripInboundHandoffHeaders(req);

    const issuedAtSec = Math.floor(opts.now() / 1000);
    // Deduplicate; the active workspace's role might also appear in
    // the platform-roles set if the user holds it in multiple slots.
    const roles = Array.from(new Set([...baseRoles, ...platformRoles]));
    const payload: HandoffPayload = {
      userId: req.auth.userId,
      workspaceId: req.workspace.id,
      workspaceSlug: req.workspace.name,
      roles,
      requestId: req.requestId,
      issuedAtSec,
    };
    const signatureHex = signHandoffPayload(payload, opts.handoffSecret);
    req.workbenchHandoff = { payload, signatureHex };
  };
}

function capabilitySetFrom(
  capabilities: ReadonlySet<Capability> | ReadonlyArray<Capability>,
): ReadonlySet<Capability> {
  return capabilities instanceof Set
    ? capabilities
    : new Set(capabilities);
}

function hasAll(
  capabilities: ReadonlySet<Capability>,
  required: ReadonlyArray<Capability> | undefined,
): boolean {
  return (required ?? []).every((capability) => capabilities.has(capability));
}

function hasAny(
  capabilities: ReadonlySet<Capability>,
  required: ReadonlyArray<Capability> | undefined,
): boolean {
  const values = required ?? [];
  return values.length === 0 || values.some((capability) => capabilities.has(capability));
}

function describeRequirement(requirement: RouteCapabilityRequirement): string {
  return [
    ...(requirement.workspaceAllOf ?? []).map((c) => `workspace:${c}`),
    ...(requirement.workspaceAnyOf ?? []).map((c) => `workspace:any:${c}`),
    ...(requirement.platformAllOf ?? []).map((c) => `platform:${c}`),
  ].join(", ");
}

function enforceRouteRequirement(args: {
  readonly requirement: RouteCapabilityRequirement;
  readonly workspaceCapabilities: ReadonlySet<Capability>;
  readonly platformCapabilities: readonly Capability[];
  readonly platformLookupFailed: boolean;
  readonly method: string;
  readonly url: string;
}): void {
  const workspace = capabilitySetFrom(args.workspaceCapabilities);
  const platform = capabilitySetFrom(args.platformCapabilities);
  const needsPlatform = (args.requirement.platformAllOf ?? []).length > 0;
  if (needsPlatform && args.platformLookupFailed) {
    throw new PermissionDeniedError(
      `Platform capability lookup failed for ${args.method} ${args.url}; refusing fail-closed.`,
    );
  }
  if (
    !hasAll(workspace, args.requirement.workspaceAllOf) ||
    !hasAny(workspace, args.requirement.workspaceAnyOf) ||
    !hasAll(platform, args.requirement.platformAllOf)
  ) {
    throw new PermissionDeniedError(
      `Caller lacks route capability requirement [${describeRequirement(args.requirement)}] for ${args.method} ${args.url}.`,
    );
  }
}

/**
 * Workbench proxy plugin. Registers @fastify/http-proxy mounted at
 * ``/api`` with slug-aware routes + the auth chain + handoff signer.
 */
export const workbenchProxyPlugin: FastifyPluginAsync<
  WorkbenchProxyOptions
> = async (app, opts) => {
  const now = opts.now ?? Date.now;
  const handoffPreHandler = buildHandoffPreHandler({
    handoffSecret: opts.handoffSecret,
    now,
    platformRolesFor: opts.platformRolesFor,
    platformCapabilitiesFor: opts.platformCapabilitiesFor,
  });

  // The preHandler argument accepts either a single function or an
  // array. We splice the auth chain in front of the handoff so the
  // §6.2 order runs first, the handoff signer runs LAST.
  const preHandler: ReadonlyArray<MiddlewareHandler> = [
    ...opts.authChain,
    handoffPreHandler,
  ];

  // @fastify/http-proxy's TypeScript declaration omits the `routes`
  // option (it's documented and exists at runtime). Cast through
  // `unknown` so the slug-aware route shapes land verbatim — the
  // alternative is forking the types, which is overkill for a single
  // missing key.
  await app.register(fastifyHttpProxy, ({
    upstream: opts.upstreamUrl,
    prefix: "/api",
    // Capture the workspace slug as a named route param so
    // loadWorkspaceBySlug can read it. The two route shapes cover
    // both ``/api/:slug`` (no trailing path) and ``/api/:slug/...``.
    routes: ["/:slug", "/:slug/*"],
    // Keep the `/api` prefix when forwarding so today's flat
    // FastAPI routes (``/api/{rest}``) still match. The default
    // strip would replace `/api` with `/`.
    rewritePrefix: "/api",
    // Strip the slug segment from the forwarded URL.
    // preRewrite receives the FULL request URL (`/api/{slug}/{rest}`)
    // and returns the URL the upstream sees. Removing the slug
    // gives `/api/{rest}` so today's flat FastAPI routes still
    // match. When Phase E5 introduces ``/api/{slug}/{rest}`` routes
    // on the FastAPI side, this preRewrite becomes the operator's
    // switch: drop the strip and the slug rides through to FastAPI
    // verbatim.
    preRewrite: rewriteWorkbenchProxyUrl,
    preHandler: preHandler as unknown as Parameters<
      typeof fastifyHttpProxy
    >[1]["preHandler"],
    replyOptions: {
      rewriteRequestHeaders: rewriteWorkbenchProxyHeaders,
    },
  } as unknown) as Parameters<typeof fastifyHttpProxy>[1]);
};

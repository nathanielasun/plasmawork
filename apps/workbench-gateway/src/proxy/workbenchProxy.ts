/**
 * Workbench proxy plugin — Phase 0.5 / Phase E2-min (2026-05-09).
 *
 * Mounts ``@fastify/http-proxy`` at the ``/api/*`` prefix and forwards
 * authenticated requests to the loopback-bound FastAPI workbench. The
 * 7 ``X-Workbench-*`` headers are computed in the ``preHandler``
 * chain and merged into the outbound request via the
 * ``replyOptions.rewriteRequestHeaders`` seam — the FastAPI side
 * verifies the HMAC against the same shared secret in
 * ``packages/core/src/simworkbench/api/auth_middleware.py``.
 *
 * Scope of this commit (E2-min, per advisor):
 *   - requireAuth (cookie session) → strip inbound X-Workbench-*
 *     headers → compute handoff → forward.
 *   - The 7 outbound headers verify against the same secret in the
 *     FastAPI middleware.
 *
 * NOT in this commit (E2-rest, follow-on):
 *   - loadWorkspace + requireWorkspaceMembership: workspace-id
 *     resolution by URL slug, membership check.
 *   - enforceCsrfForStateChange on state-changing methods.
 *   - URL slug cross-check (FastAPI side flips on once the gateway
 *     opts in).
 *
 * Until E2-rest lands, the workspace_id forwarded is a synthetic
 * placeholder derived from the URL slug — sufficient for HMAC
 * verification in the FastAPI middleware (which validates UUID
 * shape) but NOT sufficient for workspace authorization. The
 * workspace authorization gate lives in the gateway, NOT in the
 * FastAPI backend.
 */
import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fastifyHttpProxy from "@fastify/http-proxy";

import {
  HANDOFF_HEADERS,
  HANDOFF_HEADER_NAMES,
  signHandoffPayload,
  type HandoffPayload,
} from "./handoffSigner.js";
import type { MiddlewareHandler } from "../../../../packages/secure_core/src/middleware/compose.js";

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

/**
 * Slug pattern matches the workspace-slug validator
 * (``packages/core/src/simworkbench/paths.py:_WORKSPACE_SLUG_PATTERN``)
 * AND the LOGIN_SCHEMA username pattern, both 3-64 chars of
 * ``[A-Za-z0-9_-]``. Keeping them aligned means the gateway, the
 * FastAPI middleware, and the path resolver all reject the same
 * malformed inputs.
 */
const SLUG_FROM_URL_RE = /^\/api\/([A-Za-z0-9_-]{3,64})(?:\/|$|\?)/;

/**
 * Synthetic workspace UUID derivation. The HMAC payload requires a
 * workspace_id even when the gateway has not yet looked one up; we
 * use a SHA-256-derived UUID so the same slug always produces the
 * same workspace_id. E2-rest replaces this with the real DB-resolved
 * workspace_id from `loadWorkspace`.
 */
const SYNTHETIC_WORKSPACE_NAMESPACE =
  "00000000-0000-4000-8000-000000000000";

export function syntheticWorkspaceId(slug: string): string {
  // SHA-256(namespace|slug) → first 16 bytes → UUIDv4-shaped string.
  // Real cryptographic UUIDv5 would import `uuid` — overkill for a
  // placeholder. The FastAPI middleware only validates UUID shape,
  // not the namespace.
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`${SYNTHETIC_WORKSPACE_NAMESPACE}|${slug}`)
      .digest()
      .subarray(0, 16),
  );
  // Set version 4 + variant bits per RFC 4122.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface WorkbenchProxyOptions {
  /** Loopback URL of the FastAPI backend (e.g. ``http://127.0.0.1:8000``). */
  readonly upstreamUrl: string;
  /** HMAC key shared with the FastAPI middleware. */
  readonly handoffSecret: string;
  /**
   * Authentication chain run BEFORE the proxy forwards. Must contain
   * (at minimum) the cookie-session ``requireAuth`` handler, plus
   * ``attachAuditActor`` if the deployment wants audit emissions to
   * carry a server-derived actor for proxy traffic. The chain is
   * built by the host's ``buildGatewayMiddleware`` and run in order
   * before the handoff strip + sign.
   */
  readonly authChain: ReadonlyArray<MiddlewareHandler>;
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

/**
 * Build the handoff payload from `req.auth` + the URL slug, compute
 * the HMAC signature, and stash both on ``req.workbenchHandoff``.
 * The actual header emission happens in
 * ``replyOptions.rewriteRequestHeaders`` (configured below) because
 * @fastify/http-proxy forwards via reply.from; the rewriter is the
 * only seam that runs after the proxy has cloned the headers map.
 */
export function buildHandoffPreHandler(opts: {
  readonly handoffSecret: string;
  readonly now: () => number;
}): MiddlewareHandler {
  return async (req) => {
    if (req.auth === undefined) {
      // requireAuth is registered earlier in the chain; this is a
      // safety check that fails LOUD if the chain is mis-ordered.
      throw new Error(
        "workbenchProxyPlugin: req.auth missing at handoff stage — preHandler chain must run requireAuth first.",
      );
    }
    stripInboundHandoffHeaders(req);

    const slugMatch = SLUG_FROM_URL_RE.exec(req.url);
    if (slugMatch === null) {
      throw new Error(
        "workbenchProxyPlugin: /api/* URL must include a workspace slug as the first path segment.",
      );
    }
    const workspaceSlug = slugMatch[1]!;
    const workspaceId = syntheticWorkspaceId(workspaceSlug);
    const issuedAtSec = Math.floor(opts.now() / 1000);
    const payload: HandoffPayload = {
      userId: req.auth.userId,
      workspaceId,
      workspaceSlug,
      // E2-min: the user's roles aren't yet part of req.auth (the
      // session reader builds them but requireAuth doesn't load
      // them). Forward an empty role list — the FastAPI middleware
      // only validates the canonicalization, not the contents.
      roles: [],
      requestId: req.requestId,
      issuedAtSec,
    };
    const signatureHex = signHandoffPayload(payload, opts.handoffSecret);
    req.workbenchHandoff = { payload, signatureHex };
  };
}

/**
 * Workbench proxy plugin. Registers @fastify/http-proxy mounted at
 * ``/api`` with the auth chain + handoff signer.
 */
export const workbenchProxyPlugin: FastifyPluginAsync<
  WorkbenchProxyOptions
> = async (app, opts) => {
  const now = opts.now ?? Date.now;
  const handoffPreHandler = buildHandoffPreHandler({
    handoffSecret: opts.handoffSecret,
    now,
  });

  // The preHandler argument accepts either a single function or an
  // array. We splice the auth chain in front of the handoff so
  // requireAuth fires first, attachAuditActor (if registered) lands
  // before the proxy's own audit-emitting logic, and the handoff
  // signer runs LAST.
  const preHandler: ReadonlyArray<MiddlewareHandler> = [
    ...opts.authChain,
    handoffPreHandler,
  ];

  await app.register(fastifyHttpProxy, {
    upstream: opts.upstreamUrl,
    prefix: "/api",
    // KEEP the `/api` prefix when forwarding. By default
    // @fastify/http-proxy strips the registration prefix before
    // forwarding, but the FastAPI workbench's routes are mounted
    // under ``/api/...``; stripping would 404 every request. The
    // rewritePrefix option keeps it intact.
    rewritePrefix: "/api",
    preHandler: preHandler as unknown as Parameters<
      typeof fastifyHttpProxy
    >[1]["preHandler"],
    replyOptions: {
      // Outbound header rewriter. @fastify/http-proxy passes this
      // through to @fastify/reply-from which calls it once per
      // proxied request. Returning a NEW object replaces the entire
      // outbound header map.
      rewriteRequestHeaders: (req, headers) => {
        const handoff = (req as FastifyRequest).workbenchHandoff;
        if (handoff === undefined) {
          // The preHandler chain refused to run; @fastify/http-proxy
          // shouldn't reach this branch in a normal request, but if
          // it did the missing handoff lets FastAPI 401 the request.
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
      },
    },
  });
};

/**
 * Exposed for tests. Lets the test file recompute the slug → URL
 * extraction + the synthetic workspace UUID without re-deriving them.
 */
export const _internal = Object.freeze({
  SLUG_FROM_URL_RE,
});

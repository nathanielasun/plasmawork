/**
 * `composeMiddleware()` — Phase 0.5 Layer 2.
 *
 * v4 §6.2 specifies a fixed middleware order. This helper accepts a
 * list of middleware references by name and returns the corresponding
 * `preHandler` array, throwing at registration time if the caller
 * passes them out of order.
 *
 * The point is to encode the §6.2 ordering exactly once — every route
 * goes through this helper and a code-review check (cross-cutting #2 +
 * Layer 2 review) is reduced to "does the route call `composeMiddleware`
 * with names from the canonical list, not an ad-hoc array?".
 *
 * Naming policy: each middleware module exports a function whose name
 * matches the canonical name in v4 §6.1 verbatim. Composition keys are
 * those names; no aliasing.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Local middleware handler type. Equivalent to Fastify's
 * `MiddlewareHandler` but without the long generic parameter
 * list — the chain throws on rejection rather than returning early,
 * so a `Promise<void>` is the right shape everywhere.
 */
export type MiddlewareHandler = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

/**
 * Canonical middleware order from v4 §6.2 (and §6.1 listing). The
 * order is fixed — `requireRequestId` runs first so every later
 * middleware can attach to a stable id; the §16 / §6.3 approval check
 * runs last so capability + workspace scope are already verified.
 *
 * `requireWorkspaceRole` from §6.1 is folded into `requireCapability`
 * (capabilities supersede role names per ADR-0008 §13).
 */
export const MIDDLEWARE_ORDER = [
  "requireRequestId",
  "requireAuth",
  "enforceCsrfForStateChange",
  "validateInputSchema",
  "attachAuditActor",
  "loadWorkspace",
  "enforceUniformNotFound",
  "requireWorkspaceMembership",
  "requireCapability",
  "enforceObjectWorkspaceScope",
  "requireApprovalIfHighRisk",
] as const;

export type MiddlewareName = (typeof MIDDLEWARE_ORDER)[number];

const ORDER_INDEX: Readonly<Record<MiddlewareName, number>> = Object.freeze(
  Object.fromEntries(
    MIDDLEWARE_ORDER.map((name, i) => [name, i] as const),
  ) as Record<MiddlewareName, number>,
);

export interface NamedMiddleware {
  readonly name: MiddlewareName;
  readonly handler: MiddlewareHandler;
}

export class MiddlewareOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MiddlewareOrderError";
  }
}

/**
 * Compose a list of middleware in v4 §6.2 order. The implementation
 * stable-sorts on the canonical order while refusing exact duplicates
 * — passing the same middleware name twice is a programmer error
 * (e.g. composing `requireCapability("a")` and `requireCapability("b")`
 * should be expressed by chaining one combined check, not by listing
 * the name twice).
 *
 * Throws `MiddlewareOrderError` for unknown names so a typo at the
 * route registration site fails loud rather than silently dropping
 * the middleware.
 */
export function composeMiddleware(
  middlewares: ReadonlyArray<NamedMiddleware>,
): MiddlewareHandler[] {
  const seen = new Set<MiddlewareName>();
  for (const m of middlewares) {
    if (!(m.name in ORDER_INDEX)) {
      throw new MiddlewareOrderError(
        `Unknown middleware name: ${m.name}. Allowed: ${MIDDLEWARE_ORDER.join(", ")}`,
      );
    }
    if (seen.has(m.name)) {
      throw new MiddlewareOrderError(
        `Middleware ${m.name} listed twice. Combine into a single check.`,
      );
    }
    seen.add(m.name);
  }
  const sorted = [...middlewares].sort(
    (a, b) => ORDER_INDEX[a.name] - ORDER_INDEX[b.name],
  );
  return sorted.map((m) => m.handler);
}

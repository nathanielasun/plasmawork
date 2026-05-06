/**
 * `attachAuditActor` — Phase 0.5 Layer 2 / L2.8.
 *
 * Materializes `req.audit` from the server-derived `req.auth` per
 * v4 §19.1. Every audit row written downstream reads from this record;
 * the middleware NEVER reads `req.body`, so a request body field named
 * `actor`, `actor_user_id`, `user_id`, etc. (the §4.1 forbidden list)
 * cannot influence what gets written.
 *
 * Composition: runs after `validateInputSchema` per §6.2 and after
 * `requireAuth` for authenticated routes. For unauthenticated routes
 * (login, signup, ...) `req.auth` is undefined; we still attach a record
 * with `actorType: "unauthenticated"` and `actorUserId: null` so any
 * audit emission for failed pre-auth requests carries a uniform shape.
 *
 * No DI: this middleware has no dependencies, no audit emission, no
 * IO. Exported as a `NamedMiddleware` value (not a factory) so route
 * plugins reference it by import.
 */

import type { FastifyRequest } from "fastify";

import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";

const handler: MiddlewareHandler = async (
  req: FastifyRequest,
): Promise<void> => {
  // Reading `req.auth` only — `req.body` is intentionally untouched.
  // The lint rule for §4.1 enforces that no module besides
  // `validateInputSchema` reads `req.body` outside a typed handler.
  req.audit = {
    actorUserId: req.auth?.userId ?? null,
    actorType: req.auth?.actorType ?? "unauthenticated",
    requestId: req.requestId,
  };
};

export const attachAuditActor: NamedMiddleware = {
  name: "attachAuditActor",
  handler,
};

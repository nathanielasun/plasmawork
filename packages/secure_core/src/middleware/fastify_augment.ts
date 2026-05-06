/**
 * Fastify request-shape augmentation — Phase 0.5 Layer 2.
 *
 * Each middleware decorates the request object with a typed record
 * defined in `./types.ts`. Module augmentation here lets handlers read
 * `req.auth.userId` without optional-chaining / type guards once the
 * preHandler chain has run.
 *
 * Lifecycle ordering — fields appear in this order along §6.2:
 *
 *   requireRequestId          → req.requestId
 *   requireAuth               → req.auth
 *   attachAuditActor          → req.audit
 *   loadWorkspace             → req.workspace
 *   requireWorkspaceMembership→ req.membership
 *
 * Handlers that run before a given middleware MUST NOT read the field
 * that middleware sets. The compose helper enforces ordering at
 * registration time.
 */

import "fastify";
import type {
  AuthContext,
  AuditContext,
  WorkspaceContext,
  MembershipContext,
} from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    auth?: AuthContext;
    audit?: AuditContext;
    workspace?: WorkspaceContext;
    membership?: MembershipContext;
  }
}

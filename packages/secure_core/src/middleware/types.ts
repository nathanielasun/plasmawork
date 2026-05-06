/**
 * Shared middleware types — Phase 0.5 Layer 2.
 *
 * Per v4 §6.2, every middleware runs as a Fastify `preHandler` and
 * communicates by attaching strongly-typed records to the request:
 *
 *   - `req.requestId` (UUIDv7 from `requireRequestId`)
 *   - `req.auth`      (after `requireAuth`)
 *   - `req.audit`     (after `attachAuditActor`)
 *   - `req.workspace` (after `loadWorkspace`)
 *   - `req.membership`(after `requireWorkspaceMembership`)
 *
 * The shapes live here so middleware modules + tests + downstream
 * route handlers all agree. Module augmentation of Fastify's
 * `FastifyRequest` happens in `src/middleware/fastify_augment.ts`.
 */

import type { Capability } from "../config/capabilities.js";

export type ActorType =
  | "human"
  | "ai_agent"
  | "worker"
  | "operator"
  | "unauthenticated";

/**
 * Server-derived authentication context. Every privileged decision
 * reads from this record, NEVER from `req.body`. v4 §4.1 forbids
 * `actor`, `actor_user_id`, `user_id`, `created_by`, etc. in the body.
 */
export interface AuthContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly actorType: ActorType;
  readonly assuranceLevel: "aal1" | "aal2" | "aal3";
}

/**
 * Audit actor envelope attached after `attachAuditActor`. The audit
 * logger reads this at write time so the row's `actor_user_id` /
 * `actor_type` always come from the server's auth context, never the
 * caller-supplied body.
 */
export interface AuditContext {
  readonly actorUserId: string | null;
  readonly actorType: ActorType;
  readonly requestId: string;
}

export interface WorkspaceContext {
  readonly id: string;
  readonly name: string;
  readonly createdBy: string;
}

export interface MembershipContext {
  readonly workspaceId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly capabilities: ReadonlySet<Capability>;
}

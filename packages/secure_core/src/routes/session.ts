/**
 * Current-session route.
 *
 * Frontend app shells need server-derived identity, assurance level,
 * live workspace memberships, role names, and capabilities. This route
 * returns that context without accepting any JSON body or privilege
 * claim from the client.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import {
  composeMiddleware,
  type NamedMiddleware,
} from "../middleware/compose.js";
import type {
  CurrentSessionAuth,
  CurrentSessionReader,
} from "../auth/sessionService.js";
import { SecureCoreError } from "../errors/shapes.js";

export interface SessionRoutesMiddleware {
  readonly requireAuth: NamedMiddleware;
  readonly attachAuditActor: NamedMiddleware;
}

export interface SessionRoutesOptions {
  readonly service: CurrentSessionReader;
  readonly mw: SessionRoutesMiddleware;
}

const SESSION_MEMBERSHIP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "workspace_id",
    "workspace_name",
    "role_id",
    "role_name",
    "capabilities",
  ],
  properties: {
    workspace_id: { type: "string" },
    workspace_name: { type: "string" },
    role_id: { type: "string" },
    role_name: { type: "string" },
    capabilities: { type: "array", items: { type: "string" } },
  },
} as const;

export const CURRENT_SESSION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "user_id",
    "session_id",
    "actor_type",
    "assurance_level",
    "memberships",
  ],
  properties: {
    user_id: { type: "string" },
    session_id: { type: "string" },
    actor_type: {
      type: "string",
      enum: ["human", "ai_agent", "worker", "operator"],
    },
    assurance_level: { type: "string", enum: ["aal1", "aal2", "aal3"] },
    memberships: { type: "array", items: SESSION_MEMBERSHIP_SCHEMA },
  },
} as const;

export const sessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  app.get(
    "/auth/session",
    {
      schema: { response: { 200: CURRENT_SESSION_RESPONSE_SCHEMA } },
      preHandler: composeMiddleware([
        opts.mw.requireAuth,
        opts.mw.attachAuditActor,
      ]),
    },
    async (req) => {
      if (req.auth === undefined) {
        throw new SecureCoreError("UNAUTHENTICATED", "Auth required.");
      }
      if (req.auth.actorType === "unauthenticated") {
        throw new SecureCoreError(
          "UNAUTHENTICATED",
          "Authenticated actor required.",
        );
      }

      const auth: CurrentSessionAuth = {
        userId: req.auth.userId,
        sessionId: req.auth.sessionId,
        actorType: req.auth.actorType,
        assuranceLevel: req.auth.assuranceLevel,
      };
      return opts.service.getCurrentSession(auth);
    },
  );
};

import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  sessionRoutes,
  type SessionRoutesMiddleware,
} from "../../src/routes/session.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import type { NamedMiddleware } from "../../src/middleware/compose.js";
import type {
  CurrentSessionAuth,
  CurrentSessionReader,
  CurrentSessionResponse,
} from "../../src/auth/sessionService.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

interface BundleOpts {
  readonly authed?: boolean;
  readonly actorType?: "human" | "ai_agent" | "worker" | "operator" | "unauthenticated";
}

function middleware(opts: BundleOpts = {}): SessionRoutesMiddleware {
  const requireAuth: NamedMiddleware = {
    name: "requireAuth",
    handler: async (req: FastifyRequest) => {
      if (opts.authed === false) {
        throw new SecureCoreError("UNAUTHENTICATED", "no auth");
      }
      req.auth = {
        userId: USER_ID,
        sessionId: SESSION_ID,
        actorType: opts.actorType ?? "human",
        assuranceLevel: "aal2",
      };
    },
  };
  const attachAuditActor: NamedMiddleware = {
    name: "attachAuditActor",
    handler: async (req: FastifyRequest) => {
      req.audit = {
        actorUserId:
          req.auth?.actorType === "unauthenticated"
            ? null
            : (req.auth?.userId ?? null),
        actorType: req.auth?.actorType ?? "unauthenticated",
        requestId: req.requestId,
      };
    },
  };
  return { requireAuth, attachAuditActor };
}

function service(): {
  readonly reader: CurrentSessionReader;
  readonly calls: CurrentSessionAuth[];
} {
  const calls: CurrentSessionAuth[] = [];
  const response: CurrentSessionResponse = {
    user_id: USER_ID,
    session_id: SESSION_ID,
    actor_type: "human",
    assurance_level: "aal2",
    memberships: [
      {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        workspace_name: "Demo workspace",
        role_id: "44444444-4444-4444-8444-444444444444",
        role_name: "owner",
        capabilities: ["workspace:view", "run:create"],
      },
    ],
  };
  return {
    calls,
    reader: {
      getCurrentSession: async (auth) => {
        calls.push(auth);
        return response;
      },
    },
  };
}

function buildApp(
  reader: CurrentSessionReader,
  mw: SessionRoutesMiddleware,
): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requireRequestId);
  app.setErrorHandler((err, req, reply) => {
    const mapped = toHttpResponse(err, req.requestId ?? "unknown");
    reply.code(mapped.status).send(mapped.body);
  });
  void app.register(sessionRoutes, { service: reader, mw });
  return app;
}

describe("sessionRoutes", () => {
  it("GET /auth/session returns server-derived auth and memberships", async () => {
    const stub = service();
    const app = buildApp(stub.reader, middleware());

    const res = await app.inject({ method: "GET", url: "/auth/session" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user_id: USER_ID,
      session_id: SESSION_ID,
      actor_type: "human",
      assurance_level: "aal2",
      memberships: [
        {
          workspace_name: "Demo workspace",
          role_name: "owner",
        },
      ],
    });
    expect(stub.calls).toEqual([
      {
        userId: USER_ID,
        sessionId: SESSION_ID,
        actorType: "human",
        assuranceLevel: "aal2",
      },
    ]);
  });

  it("GET /auth/session refuses missing auth before service call", async () => {
    const stub = service();
    const app = buildApp(stub.reader, middleware({ authed: false }));

    const res = await app.inject({ method: "GET", url: "/auth/session" });

    expect(res.statusCode).toBe(401);
    expect(stub.calls).toHaveLength(0);
  });

  it("GET /auth/session refuses malformed unauthenticated auth context", async () => {
    const stub = service();
    const app = buildApp(
      stub.reader,
      middleware({ actorType: "unauthenticated" }),
    );

    const res = await app.inject({ method: "GET", url: "/auth/session" });

    expect(res.statusCode).toBe(401);
    expect(stub.calls).toHaveLength(0);
  });
});

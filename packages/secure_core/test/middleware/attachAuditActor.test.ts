/**
 * L2.8 `attachAuditActor` — behavior tests.
 *
 * Pins:
 *  - With `req.auth` set, `req.audit` mirrors the server-derived actor.
 *  - Without `req.auth`, `actorType` is `"unauthenticated"` and
 *    `actorUserId` is `null` — the V4-R3 pre-auth shape.
 *  - A request body containing `actor_user_id` MUST be ignored —
 *    proves the §4.1 forbidden-field rule.
 */
import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

import { attachAuditActor } from "../../src/middleware/attachAuditActor.js";
import { composeMiddleware } from "../../src/middleware/compose.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import "../../src/middleware/fastify_augment.js";
import type { AuthContext } from "../../src/middleware/types.js";

async function buildTestApp(opts: {
  injectAuth?: AuthContext;
}): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  app.addHook("onRequest", requireRequestId);

  if (opts.injectAuth !== undefined) {
    app.addHook("preHandler", async (req) => {
      req.auth = opts.injectAuth;
    });
  }

  const handlers = composeMiddleware([attachAuditActor]);

  app.post(
    "/echo",
    { preHandler: handlers },
    async (req) => ({
      ok: true,
      audit: req.audit ?? null,
      // Echo the body for the "body is not consulted" assertion below.
      body: req.body ?? null,
    }),
  );

  return app;
}

describe("attachAuditActor", () => {
  it("populates req.audit from req.auth when authenticated", async () => {
    const auth: AuthContext = {
      userId: "11111111-1111-1111-1111-111111111111",
      sessionId: "22222222-2222-2222-2222-222222222222",
      actorType: "human",
      assuranceLevel: "aal2",
    };
    const app = await buildTestApp({ injectAuth: auth });

    const res = await app.inject({
      method: "POST",
      url: "/echo",
      payload: {},
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      audit: { actorUserId: string; actorType: string; requestId: string };
    };
    expect(body.audit.actorUserId).toBe(auth.userId);
    expect(body.audit.actorType).toBe("human");
    // `requestId` is the UUIDv7 minted by `requireRequestId`.
    expect(typeof body.audit.requestId).toBe("string");
    expect(body.audit.requestId.length).toBeGreaterThan(0);
    await app.close();
  });

  it("falls back to unauthenticated/null when req.auth is undefined", async () => {
    const app = await buildTestApp({});
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      payload: {},
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      audit: { actorUserId: string | null; actorType: string };
    };
    expect(body.audit).toMatchObject({
      actorUserId: null,
      actorType: "unauthenticated",
    });
    await app.close();
  });

  it("ignores actor_user_id supplied in the request body (§4.1)", async () => {
    const app = await buildTestApp({});
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      payload: {
        actor_user_id: "99999999-9999-9999-9999-999999999999",
        actor: "human",
      },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      audit: { actorUserId: string | null; actorType: string };
    };
    expect(body.audit.actorUserId).toBeNull();
    expect(body.audit.actorType).toBe("unauthenticated");
    await app.close();
  });
});

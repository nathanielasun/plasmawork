/**
 * Proxy plugin integration test — Phase 0.5 / Phase E2-rest (2026-05-09).
 *
 * Pins the workbench proxy's wiring against an in-process fake proxy
 * adapter. The test:
 *
 *   1. Replaces @fastify/http-proxy with an in-process adapter that
 *      captures the request URL and rewritten headers. No real listen
 *      socket is opened, so the test runs inside sandboxed CI.
 *   2. Builds a gateway-shaped Fastify app that uses the exported
 *      proxy preHandler/rewrite helpers. The auth chain is a list of
 *      stub middlewares that injects a
 *      fixed `req.auth` + `req.workspace` + `req.membership` so the
 *      test doesn't need a real cookie / DB.
 *   3. Sends a request through the gateway via `app.inject`.
 *   4. Asserts the in-process capture saw the 7 ``X-Workbench-*``
 *      headers AND that the signature verifies against the same
 *      shared secret. This mirrors what the FastAPI middleware does at
 *      production runtime.
 *
 * E2-rest behaviors pinned (in addition to E2-min's HMAC sign-and-
 * forward):
 *   - The handoff carries the REAL workspace_id from the stub
 *     `req.workspace.id`, not a SHA-256 placeholder.
 *   - The handoff carries the REAL role list from the stub
 *     `req.membership.roleName`, not an empty array.
 *   - The slug is stripped from the forwarded URL so today's flat
 *     `/api/{rest}` FastAPI routes still match.
 *   - When the workspace authorization stub refuses (404), the
 *     proxy never forwards.
 */

import { beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  buildHandoffPreHandler,
  rewriteWorkbenchProxyHeaders,
  rewriteWorkbenchProxyUrl,
} from "../../src/proxy/workbenchProxy.js";
import {
  HANDOFF_HEADERS,
  buildHandoffPayload,
  signHandoffPayload,
  verifyHandoffSignature,
  type HandoffPayload,
} from "../../src/proxy/handoffSigner.js";
import { requireRequestId } from "../../../../packages/secure_core/src/middleware/requireRequestId.js";
import type {
  AuthContext,
  ActorType,
  WorkspaceContext,
  MembershipContext,
} from "../../../../packages/secure_core/src/middleware/types.js";
import type { MiddlewareHandler } from "../../../../packages/secure_core/src/middleware/compose.js";
import { NotFoundError } from "../../../../packages/secure_core/src/errors/shapes.js";
import { toHttpResponse } from "../../../../packages/secure_core/src/errors/mapper.js";
import type { Capability } from "../../../../packages/secure_core/src/config/capabilities.js";

const HANDOFF_SECRET = "z".repeat(64);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_SLUG = "shared-public-experiments";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const ROLE_NAME = "WorkspaceAdmin";

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * Stub auth chain: pre-populates req.auth, req.workspace, req.membership
 * so the proxy's handoff signer has the data it needs without hitting
 * a real DB.
 */
function buildStubAuthChain(opts?: {
  readonly refuseMembership?: boolean;
}): ReadonlyArray<MiddlewareHandler> {
  const stubRequireAuth: MiddlewareHandler = async (
    req: FastifyRequest,
  ) => {
    const auth: AuthContext = {
      userId: USER_ID,
      sessionId: SESSION_ID,
      actorType: "human" as ActorType,
      assuranceLevel: "aal2",
    };
    req.auth = auth;
  };
  const stubLoadWorkspace: MiddlewareHandler = async (
    req: FastifyRequest,
  ) => {
    const workspace: WorkspaceContext = {
      id: WORKSPACE_ID,
      name: WORKSPACE_SLUG,
      createdBy: USER_ID,
    };
    req.workspace = workspace;
  };
  const stubRequireMembership: MiddlewareHandler = async (
    req: FastifyRequest,
  ) => {
    if (opts?.refuseMembership === true) {
      throw new NotFoundError("Not found.");
    }
    const membership: MembershipContext = {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      roleId: "5b807f69-df63-5054-a96a-490c9668a567",
      roleName: ROLE_NAME,
      capabilities: new Set(),
    };
    req.membership = membership;
  };
  return [stubRequireAuth, stubLoadWorkspace, stubRequireMembership];
}

async function buildProxyOnlyApp(args: {
  readonly captures: CapturedRequest[];
  readonly authChain: ReadonlyArray<MiddlewareHandler>;
  readonly clock?: () => number;
  readonly platformRolesFor?: (userId: string) => Promise<readonly string[]>;
  readonly platformCapabilitiesFor?: (
    userId: string,
  ) => Promise<readonly Capability[]>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requireRequestId);
  // secure_core's mapper turns NotFoundError → 404, etc. Production
  // wires this through `buildApp()`; the test does it manually.
  app.setErrorHandler((err, req, reply) => {
    const mapped = toHttpResponse(err, req.requestId ?? "unknown");
    reply.code(mapped.status).send(mapped.body);
  });
  const handoffPreHandler = buildHandoffPreHandler({
    handoffSecret: HANDOFF_SECRET,
    now: args.clock ?? Date.now,
    platformRolesFor: args.platformRolesFor,
    platformCapabilitiesFor: args.platformCapabilitiesFor,
  });
  const preHandler = [...args.authChain, handoffPreHandler];
  const handler = async (req: FastifyRequest) => {
    args.captures.push({
      url: rewriteWorkbenchProxyUrl(req.url),
      method: req.method,
      headers: rewriteWorkbenchProxyHeaders(req, { ...req.headers }),
    });
    return { ok: true };
  };
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  app.route({
    method: methods,
    url: "/api/:slug",
    preHandler: preHandler as never,
    handler,
  });
  app.route({
    method: methods,
    url: "/api/:slug/*",
    preHandler: preHandler as never,
    handler,
  });
  return app;
}

// ---------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------

describe("workbenchProxyPlugin (E2-rest)", () => {
  let captures: CapturedRequest[];

  beforeEach(() => {
    captures = [];
    captures.length = 0;
  });

  it("forwards GET /api/{slug}/foo with handoff carrying the real workspace_id + role", async () => {
    captures.length = 0;
    const fixedClock = () => 1_700_000_000_000; // ms; 1700000000 sec
    const app = await buildProxyOnlyApp({
      captures,
      authChain: buildStubAuthChain(),
      clock: fixedClock,
    });

    const r = await app.inject({
      method: "GET",
      url: `/api/${WORKSPACE_SLUG}/capsules`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });

    expect(captures).toHaveLength(1);
    const captured = captures[0]!;
    // Slug stripped from the forwarded URL — today's flat FastAPI
    // routes (`/api/capsules`) still match.
    expect(captured.url).toBe("/api/capsules");

    // Handoff carries REAL workspace_id (not synthetic).
    expect(captured.headers[HANDOFF_HEADERS.USER_ID]).toBe(USER_ID);
    expect(captured.headers[HANDOFF_HEADERS.WORKSPACE_ID]).toBe(WORKSPACE_ID);
    expect(captured.headers[HANDOFF_HEADERS.WORKSPACE_SLUG]).toBe(
      WORKSPACE_SLUG,
    );
    // Handoff carries the REAL role list (not empty).
    expect(captured.headers[HANDOFF_HEADERS.ROLES]).toBe(ROLE_NAME);
    expect(captured.headers[HANDOFF_HEADERS.ISSUED_AT]).toBe(
      "1700000000",
    );

    // The signature verifies against the same secret + payload.
    const reconstructedPayload: HandoffPayload = {
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSlug: WORKSPACE_SLUG,
      roles: [ROLE_NAME],
      requestId: captured.headers[HANDOFF_HEADERS.REQUEST_ID] as string,
      issuedAtSec: 1_700_000_000,
    };
    const expectedSig = signHandoffPayload(
      reconstructedPayload,
      HANDOFF_SECRET,
    );
    expect(captured.headers[HANDOFF_HEADERS.SIGNATURE]).toBe(expectedSig);

    await app.close();
  });

  it("strips inbound X-Workbench-* headers from the client (defense)", async () => {
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      captures,
      authChain: buildStubAuthChain(),
    });

    const FORGED_USER = "deadbeef-dead-4ead-bead-deaddeaddead";
    const r = await app.inject({
      method: "GET",
      url: `/api/${WORKSPACE_SLUG}/capsules`,
      headers: {
        [HANDOFF_HEADERS.USER_ID]: FORGED_USER,
        [HANDOFF_HEADERS.SIGNATURE]: "0".repeat(64),
      },
    });
    expect(r.statusCode).toBe(200);

    expect(captures).toHaveLength(1);
    const captured = captures[0]!;
    // The forged user-id MUST be replaced by the gateway-derived one.
    expect(captured.headers[HANDOFF_HEADERS.USER_ID]).toBe(USER_ID);
    expect(captured.headers[HANDOFF_HEADERS.USER_ID]).not.toBe(FORGED_USER);
    expect(captured.headers[HANDOFF_HEADERS.SIGNATURE]).not.toBe(
      "0".repeat(64),
    );

    await app.close();
  });

  it("FastAPI-side HMAC verification accepts the gateway's headers (round-trip)", async () => {
    const app = await buildProxyOnlyApp({
      captures,
      authChain: buildStubAuthChain(),
    });

    const r = await app.inject({
      method: "GET",
      url: `/api/${WORKSPACE_SLUG}/capsules`,
    });
    expect(r.statusCode).toBe(200);
    expect(captures).toHaveLength(1);
    const captured = captures[0]!;
    const payload: HandoffPayload = {
      userId: captured.headers[HANDOFF_HEADERS.USER_ID] as string,
      workspaceId: captured.headers[HANDOFF_HEADERS.WORKSPACE_ID] as string,
      workspaceSlug: captured.headers[HANDOFF_HEADERS.WORKSPACE_SLUG] as string,
      roles: String(captured.headers[HANDOFF_HEADERS.ROLES] ?? "").split(","),
      requestId: captured.headers[HANDOFF_HEADERS.REQUEST_ID] as string,
      issuedAtSec: Number.parseInt(
        captured.headers[HANDOFF_HEADERS.ISSUED_AT] as string,
        10,
      ),
    };
    expect(
      verifyHandoffSignature(
        payload,
        captured.headers[HANDOFF_HEADERS.SIGNATURE] as string,
        HANDOFF_SECRET,
      ),
    ).toBe(true);

    await app.close();
  });

  it("workspace-membership refusal returns 404 and never forwards", async () => {
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      captures,
      authChain: buildStubAuthChain({ refuseMembership: true }),
    });

    const r = await app.inject({
      method: "GET",
      url: `/api/${WORKSPACE_SLUG}/capsules`,
    });
    expect(r.statusCode).toBe(404);
    expect(captures).toHaveLength(0);

    await app.close();
  });

  it("preRewrite strips the slug for every /api/{slug}/{...} URL (ADR-0014 posture)", async () => {
    // Explicit regression for ADR-0014's "Slug cross-check posture
    // (resolved 2026-05-10)" section. The gateway MUST strip the
    // workspace slug before forwarding to FastAPI — flipping this
    // off requires a coordinated change to both the proxy AND the
    // FastAPI middleware's slug_prefixed_paths config (the third
    // defense). One without the other is a regression.
    //
    // The strip is exercised by every handoff test above as a side
    // effect; this test names the contract directly so a future
    // refactor that drops `preRewrite` (e.g. a config-cleanup PR)
    // surfaces the intent change at review time.
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      captures,
      authChain: buildStubAuthChain(),
    });

    // Three different URL shapes, all must arrive slug-stripped.
    const cases: ReadonlyArray<readonly [string, string]> = [
      [`/api/${WORKSPACE_SLUG}/capsules`, "/api/capsules"],
      [`/api/${WORKSPACE_SLUG}/runs/abc`, "/api/runs/abc"],
      [`/api/${WORKSPACE_SLUG}/tools/foo/runs`, "/api/tools/foo/runs"],
    ];
    for (const [inUrl] of cases) {
      const r = await app.inject({ method: "GET", url: inUrl });
      expect(r.statusCode).toBe(200);
    }
    expect(captures.map((c) => c.url)).toEqual(
      cases.map(([, expected]) => expected),
    );

    await app.close();
  });

  it("URL without a slug → 404 (Fastify routing miss; never reaches upstream)", async () => {
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      captures,
      authChain: buildStubAuthChain(),
    });

    // /api with no further segments — the slug-aware route doesn't
    // match; Fastify returns 404 before reaching the proxy.
    const r = await app.inject({
      method: "GET",
      url: "/api",
    });
    expect(r.statusCode).toBe(404);
    expect(captures).toHaveLength(0);

    await app.close();
  });

  it("refuses /tools/import when caller lacks tool:create capability (audit fix 2026-05-10)", async () => {
    // Audit fix #2: the proxy auth chain previously checked
    // workspace membership only — any member could call mutating
    // legacy /api/* routes. The route capability map closes that
    // by gating mutations on per-route capabilities BEFORE the
    // proxy forwards.
    captures.length = 0;
    const stubAuthChain: ReadonlyArray<MiddlewareHandler> = [
      async (req) => {
        const auth: AuthContext = {
          userId: USER_ID,
          sessionId: SESSION_ID,
          actorType: "human" as ActorType,
          assuranceLevel: "aal2",
        };
        req.auth = auth;
      },
      async (req) => {
        req.workspace = {
          id: WORKSPACE_ID,
          name: WORKSPACE_SLUG,
          createdBy: USER_ID,
        };
      },
      async (req) => {
        // Member with a Researcher-shape capability set — NO
        // tool:create. The capability map should refuse import.
        req.membership = {
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          roleId: "5b807f69-df63-5054-a96a-490c9668a567",
          roleName: "Researcher",
          capabilities: new Set(["capsule:read", "run:create"]),
        };
      },
    ];
    const app = await buildProxyOnlyApp({
      captures,
      authChain: stubAuthChain,
    });
    const r = await app.inject({
      method: "POST",
      url: `/api/${WORKSPACE_SLUG}/tools/import`,
      headers: { "content-type": "application/json" },
      payload: { source_path: "/tmp/x", target_name: "x" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
    // Critically: the simulated upstream NEVER saw the request.
    expect(captures).toHaveLength(0);

    await app.close();
  });

  it("allows /tools/import when caller has tool:create capability", async () => {
    captures.length = 0;
    const stubAuthChain: ReadonlyArray<MiddlewareHandler> = [
      async (req) => {
        const auth: AuthContext = {
          userId: USER_ID,
          sessionId: SESSION_ID,
          actorType: "human" as ActorType,
          assuranceLevel: "aal2",
        };
        req.auth = auth;
      },
      async (req) => {
        req.workspace = {
          id: WORKSPACE_ID,
          name: WORKSPACE_SLUG,
          createdBy: USER_ID,
        };
      },
      async (req) => {
        req.membership = {
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          roleId: "5b807f69-df63-5054-a96a-490c9668a567",
          roleName: "WorkspaceAdmin",
          capabilities: new Set([
            "capsule:read",
            "tool:create",
            "tool:request_promotion",
          ]),
        };
      },
    ];
    const app = await buildProxyOnlyApp({
      captures,
      authChain: stubAuthChain,
    });
    const r = await app.inject({
      method: "POST",
      url: `/api/${WORKSPACE_SLUG}/tools/import`,
      headers: { "content-type": "application/json" },
      payload: { source_path: "/tmp/x", target_name: "x" },
    });
    expect(r.statusCode).toBe(200);
    expect(captures).toHaveLength(1);

    await app.close();
  });

  it("refuses unmapped mutating /api routes before forwarding (fail-closed)", async () => {
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      captures,
      authChain: buildStubAuthChain(),
    });

    const r = await app.inject({
      method: "PATCH",
      url: `/api/${WORKSPACE_SLUG}/future-mutation`,
      headers: { "content-type": "application/json" },
      payload: { ok: true },
    });

    expect(r.statusCode).toBe(403);
    expect(captures).toHaveLength(0);
    await app.close();
  });

  it("allows platform approval when capability lives outside active workspace", async () => {
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      captures,
      authChain: buildStubAuthChain(),
      platformRolesFor: async () => ["IncidentRemediator"],
      platformCapabilitiesFor: async () => ["platform:incident_remediate"],
    });

    const r = await app.inject({
      method: "POST",
      url: `/api/${WORKSPACE_SLUG}/tool-promotions/request-1/approve`,
      headers: { "content-type": "application/json" },
      payload: { decision_note: "approved" },
    });

    expect(r.statusCode).toBe(200);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.headers[HANDOFF_HEADERS.ROLES]).toContain(
      "IncidentRemediator",
    );
    await app.close();
  });

  it("refuses platform approval without platform capability even for active workspace admin", async () => {
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      captures,
      authChain: buildStubAuthChain(),
      platformRolesFor: async () => [],
      platformCapabilitiesFor: async () => [],
    });

    const r = await app.inject({
      method: "POST",
      url: `/api/${WORKSPACE_SLUG}/tool-promotions/request-1/approve`,
      headers: { "content-type": "application/json" },
      payload: { decision_note: "approved" },
    });

    expect(r.statusCode).toBe(403);
    expect(captures).toHaveLength(0);
    await app.close();
  });

  it("payload canonicalization: same headers → same signature regardless of role insertion order", async () => {
    const a: HandoffPayload = {
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceSlug: WORKSPACE_SLUG,
      roles: ["WorkspaceAdmin", "Researcher"],
      requestId: "00000000-0000-4000-8000-000000000000",
      issuedAtSec: 1_700_000_000,
    };
    const b: HandoffPayload = {
      ...a,
      roles: ["Researcher", "WorkspaceAdmin"],
    };
    expect(buildHandoffPayload(a)).toBe(buildHandoffPayload(b));
    expect(signHandoffPayload(a, HANDOFF_SECRET)).toBe(
      signHandoffPayload(b, HANDOFF_SECRET),
    );
  });
});

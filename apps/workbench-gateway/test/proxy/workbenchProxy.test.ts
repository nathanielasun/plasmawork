/**
 * Proxy plugin integration test — Phase 0.5 / Phase E2-rest (2026-05-09).
 *
 * Pins the workbench proxy's wiring against a STUB upstream Fastify
 * server. The test:
 *
 *   1. Spins up a stub upstream on a free port. The upstream
 *      captures every inbound request + its headers.
 *   2. Builds a gateway with `workbenchProxyPlugin` registered. The
 *      auth chain is a list of stub middlewares that injects a
 *      fixed `req.auth` + `req.workspace` + `req.membership` so the
 *      test doesn't need a real cookie / DB.
 *   3. Sends a request through the gateway via `app.inject`.
 *   4. Asserts the stub upstream saw the 7 ``X-Workbench-*`` headers
 *      AND that the signature verifies against the same shared
 *      secret on the upstream side. The upstream's verification
 *      mirrors what the FastAPI middleware does at production
 *      runtime.
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { workbenchProxyPlugin } from "../../src/proxy/workbenchProxy.js";
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

function makeStubUpstream(opts: {
  readonly captures: CapturedRequest[];
  readonly verifyHandoff?: boolean;
}): Promise<{ close: () => Promise<void>; baseUrl: string }> {
  const server = createServer((req, res) => {
    opts.captures.push({
      url: req.url ?? "",
      method: req.method ?? "GET",
      headers: { ...req.headers },
    });
    if (opts.verifyHandoff === true) {
      const userId = req.headers[HANDOFF_HEADERS.USER_ID];
      const workspaceId = req.headers[HANDOFF_HEADERS.WORKSPACE_ID];
      const workspaceSlug = req.headers[HANDOFF_HEADERS.WORKSPACE_SLUG];
      const roles = req.headers[HANDOFF_HEADERS.ROLES];
      const requestId = req.headers[HANDOFF_HEADERS.REQUEST_ID];
      const issuedAt = req.headers[HANDOFF_HEADERS.ISSUED_AT];
      const signature = req.headers[HANDOFF_HEADERS.SIGNATURE];
      if (
        typeof userId !== "string" ||
        typeof workspaceId !== "string" ||
        typeof workspaceSlug !== "string" ||
        typeof roles !== "string" ||
        typeof requestId !== "string" ||
        typeof issuedAt !== "string" ||
        typeof signature !== "string"
      ) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "missing handoff headers" }));
        return;
      }
      const payload: HandoffPayload = {
        userId,
        workspaceId,
        workspaceSlug,
        roles: roles.length > 0 ? roles.split(",") : [],
        requestId,
        issuedAtSec: Number.parseInt(issuedAt, 10),
      };
      if (!verifyHandoffSignature(payload, signature, HANDOFF_SECRET)) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "invalid signature" }));
        return;
      }
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        async close() {
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
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
  readonly upstreamUrl: string;
  readonly authChain: ReadonlyArray<MiddlewareHandler>;
  readonly clock?: () => number;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requireRequestId);
  // secure_core's mapper turns NotFoundError → 404, etc. Production
  // wires this through `buildApp()`; the test does it manually.
  app.setErrorHandler((err, req, reply) => {
    const mapped = toHttpResponse(err, req.requestId ?? "unknown");
    reply.code(mapped.status).send(mapped.body);
  });
  await app.register(workbenchProxyPlugin, {
    upstreamUrl: args.upstreamUrl,
    handoffSecret: HANDOFF_SECRET,
    authChain: args.authChain,
    now: args.clock,
  });
  return app;
}

// ---------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------

describe("workbenchProxyPlugin (E2-rest)", () => {
  let captures: CapturedRequest[];
  let upstream: { close: () => Promise<void>; baseUrl: string };

  beforeAll(async () => {
    captures = [];
    upstream = await makeStubUpstream({ captures });
  });

  afterAll(async () => {
    await upstream.close();
  });

  it("forwards GET /api/{slug}/foo with handoff carrying the real workspace_id + role", async () => {
    captures.length = 0;
    const fixedClock = () => 1_700_000_000_000; // ms; 1700000000 sec
    const app = await buildProxyOnlyApp({
      upstreamUrl: upstream.baseUrl,
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
      upstreamUrl: upstream.baseUrl,
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

  it("upstream-side HMAC verification accepts the gateway's headers (round-trip)", async () => {
    const verifyCaptures: CapturedRequest[] = [];
    const verifyingUpstream = await makeStubUpstream({
      captures: verifyCaptures,
      verifyHandoff: true,
    });
    try {
      const app = await buildProxyOnlyApp({
        upstreamUrl: verifyingUpstream.baseUrl,
        authChain: buildStubAuthChain(),
      });

      const r = await app.inject({
        method: "GET",
        url: `/api/${WORKSPACE_SLUG}/capsules`,
      });
      expect(r.statusCode).toBe(200);
      expect(verifyCaptures).toHaveLength(1);

      await app.close();
    } finally {
      await verifyingUpstream.close();
    }
  });

  it("workspace-membership refusal returns 404 and never forwards", async () => {
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      upstreamUrl: upstream.baseUrl,
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

  it("URL without a slug → 404 (Fastify routing miss; never reaches upstream)", async () => {
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      upstreamUrl: upstream.baseUrl,
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

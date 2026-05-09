/**
 * Proxy plugin integration test — Phase 0.5 / Phase E2-min (2026-05-09).
 *
 * Pins the workbench proxy's wiring against a STUB upstream Fastify
 * server. The test:
 *
 *   1. Spins up a stub upstream on a free port. The upstream
 *      captures every inbound request + its headers.
 *   2. Builds a gateway with `workbenchProxyPlugin` registered, the
 *      auth chain is a single middleware that injects a fixed
 *      `req.auth` (so the test doesn't need a real cookie / DB).
 *   3. Sends a request through the gateway via `app.inject`.
 *   4. Asserts the stub upstream saw the 7 ``X-Workbench-*`` headers
 *      AND that the signature verifies against the same shared
 *      secret on the upstream side. The upstream's verification
 *      mirrors what the FastAPI middleware does at production
 *      runtime.
 *
 * This covers the wiring contract: auth runs, the handoff payload is
 * computed from `req.auth` + URL slug, the 7 headers reach the
 * upstream, and the signature verifies. It does NOT cover:
 *   - The cookie-session ``requireAuth`` against a real DB (covered
 *     by secure_core's `requireAuth.test.ts`).
 *   - Workspace authorization (E2-rest).
 *   - The Python middleware's actual hmac.compare_digest behavior
 *     (covered by `tests/integration/test_api_auth_middleware.py`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { workbenchProxyPlugin, syntheticWorkspaceId } from "../../src/proxy/workbenchProxy.js";
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
} from "../../../../packages/secure_core/src/middleware/types.js";
import type { MiddlewareHandler } from "../../../../packages/secure_core/src/middleware/compose.js";

const HANDOFF_SECRET = "z".repeat(64);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_SLUG = "shared-public-experiments";

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * Stub upstream that captures every inbound request's URL, method, and
 * headers, then responds 200. The `verifyHandoff` argument is invoked
 * inline so a failed verification produces a 401 — mirroring the
 * FastAPI middleware's behavior.
 */
function makeStubUpstream(opts: {
  readonly captures: CapturedRequest[];
  readonly verifyHandoff?: boolean;
}): { close: () => Promise<void>; baseUrl: string } {
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
  return new Promise<{ close: () => Promise<void>; baseUrl: string }>(
    (resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        resolve({
          baseUrl: `http://127.0.0.1:${addr.port}`,
          async close() {
            await new Promise<void>((r) => server.close(() => r()));
          },
        });
      });
    },
  ) as unknown as { close: () => Promise<void>; baseUrl: string };
}

/**
 * Stub auth handler that injects a fixed `req.auth` so the proxy's
 * `requireAuth` slot is filled. Production wires the cookie-session
 * ``requireAuth`` from secure_core; this stub stands in for it.
 */
function buildStubRequireAuth(): MiddlewareHandler {
  return async (req: FastifyRequest) => {
    const auth: AuthContext = {
      userId: USER_ID,
      sessionId: SESSION_ID,
      actorType: "human" as ActorType,
      assuranceLevel: "aal2",
    };
    req.auth = auth;
  };
}

/**
 * Build a gateway-shaped Fastify app with only the proxy plugin
 * registered. Saves wiring composeServices for the proxy-specific
 * smoke.
 */
async function buildProxyOnlyApp(args: {
  readonly upstreamUrl: string;
  readonly authChain: ReadonlyArray<MiddlewareHandler>;
  readonly clock?: () => number;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", requireRequestId);
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

describe("workbenchProxyPlugin (E2-min)", () => {
  let captures: CapturedRequest[];
  let upstream: { close: () => Promise<void>; baseUrl: string };

  beforeAll(async () => {
    captures = [];
    upstream = await makeStubUpstream({ captures });
  });

  afterAll(async () => {
    await upstream.close();
  });

  it("forwards GET /api/{slug}/foo with the 7 X-Workbench-* headers + valid HMAC", async () => {
    captures.length = 0;
    const fixedClock = () => 1_700_000_000_000; // ms; 1700000000 sec
    const app = await buildProxyOnlyApp({
      upstreamUrl: upstream.baseUrl,
      authChain: [buildStubRequireAuth()],
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
    expect(captured.method).toBe("GET");
    expect(captured.url).toBe(`/api/${WORKSPACE_SLUG}/capsules`);

    expect(captured.headers[HANDOFF_HEADERS.USER_ID]).toBe(USER_ID);
    expect(captured.headers[HANDOFF_HEADERS.WORKSPACE_SLUG]).toBe(
      WORKSPACE_SLUG,
    );
    expect(captured.headers[HANDOFF_HEADERS.ISSUED_AT]).toBe(
      "1700000000",
    );
    expect(captured.headers[HANDOFF_HEADERS.WORKSPACE_ID]).toBe(
      syntheticWorkspaceId(WORKSPACE_SLUG),
    );
    expect(captured.headers[HANDOFF_HEADERS.ROLES]).toBe("");

    // The signature MUST verify against the same secret + payload.
    const reconstructedPayload: HandoffPayload = {
      userId: USER_ID,
      workspaceId: syntheticWorkspaceId(WORKSPACE_SLUG),
      workspaceSlug: WORKSPACE_SLUG,
      roles: [],
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
      authChain: [buildStubRequireAuth()],
    });

    const FORGED_USER = "deadbeef-dead-4ead-bead-deaddeaddead";
    const r = await app.inject({
      method: "GET",
      url: `/api/${WORKSPACE_SLUG}/capsules`,
      headers: {
        [HANDOFF_HEADERS.USER_ID]: FORGED_USER,
        // A pre-set signature would defeat HMAC verification if the
        // gateway didn't strip + re-sign.
        [HANDOFF_HEADERS.SIGNATURE]: "0".repeat(64),
      },
    });
    expect(r.statusCode).toBe(200);

    expect(captures).toHaveLength(1);
    const captured = captures[0]!;
    // The forged user-id MUST be replaced by the gateway-derived one.
    expect(captured.headers[HANDOFF_HEADERS.USER_ID]).toBe(USER_ID);
    expect(captured.headers[HANDOFF_HEADERS.USER_ID]).not.toBe(FORGED_USER);
    // The forged signature MUST be replaced by the gateway's HMAC.
    expect(captured.headers[HANDOFF_HEADERS.SIGNATURE]).not.toBe(
      "0".repeat(64),
    );
    expect(
      typeof captured.headers[HANDOFF_HEADERS.SIGNATURE],
    ).toBe("string");

    await app.close();
  });

  it("upstream-side HMAC verification accepts the gateway's headers (round-trip)", async () => {
    // Spin up a fresh stub that VERIFIES on every request (not just
    // captures). A 200 from a verifying upstream proves the gateway's
    // headers + payload exactly match what the FastAPI middleware will
    // accept in production.
    const verifyCaptures: CapturedRequest[] = [];
    const verifyingUpstream = await makeStubUpstream({
      captures: verifyCaptures,
      verifyHandoff: true,
    });
    try {
      const app = await buildProxyOnlyApp({
        upstreamUrl: verifyingUpstream.baseUrl,
        authChain: [buildStubRequireAuth()],
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

  it("URL without a slug → 500 (preHandler refuses the request)", async () => {
    captures.length = 0;
    const app = await buildProxyOnlyApp({
      upstreamUrl: upstream.baseUrl,
      authChain: [buildStubRequireAuth()],
    });

    // /api with no further segments — the slug regex doesn't match.
    const r = await app.inject({
      method: "GET",
      url: "/api",
    });
    // The preHandler throws; Fastify's default error handler returns 500.
    // Real production wires the secure_core error handler which would
    // map this to a 4xx; for the smoke we just confirm the proxy
    // never forwarded.
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(captures).toHaveLength(0);

    await app.close();
  });

  it("payload canonicalization: same headers → same signature regardless of role insertion order", async () => {
    // Roles aren't yet pulled from req.auth in E2-min (always empty),
    // but pin the canonicalization invariant via a direct call to
    // buildHandoffPayload + signHandoffPayload so a future refactor
    // can't silently break the `sort().join(",")` contract.
    const a: HandoffPayload = {
      userId: USER_ID,
      workspaceId: syntheticWorkspaceId(WORKSPACE_SLUG),
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

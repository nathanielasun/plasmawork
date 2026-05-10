/**
 * Integration smoke test for the workbench-gateway auth vertical —
 * Phase 0.5 / Phase D (2026-05-09).
 *
 * Closes the advisor's "end-to-end is unverified" finding from the
 * Phase E close: until this test landed, every secure_core route
 * plugin had its own in-package test, but no test pinned the gateway's
 * wiring contract — that the host correctly threads
 * `loginService → loginRoutes`, `sessionReader → sessionRoutes`, and
 * `bootstrapService → bootstrapRoutes` together.
 *
 * The test runs against `app.inject` (no real socket) and stubs every
 * service. Real services live in `composeServices.ts`; the wiring
 * between routes + middleware bundles runs verbatim because the test
 * uses the real `buildGateway()` factory with `services` injected.
 *
 * Vertical pinned:
 *
 *   1. POST /bootstrap with the matching OOB credential → 201 +
 *      admin_user_id; second call lands the WORM seal so a third call
 *      returns the registration-time 404.
 *   2. POST /auth/login with the seeded admin credentials → 200 with
 *      `secure_session` (HttpOnly) + `csrf_token` (non-HttpOnly)
 *      Set-Cookie headers + the canonical body shape.
 *   3. GET /auth/session without a cookie → 401 (pre-DB short-circuit
 *      in `requireAuth`).
 *
 * The /auth/session happy-path (cookie → 200 + memberships) requires
 * `requireAuth` to hit a real `sessions`/`users` join; that's covered
 * by the secure_core in-package tests. This smoke test pins the
 * gateway's host wiring; the route plugin internals are pinned in their
 * own packages.
 *
 * Pre-auth + Origin allowlist guards run real code so a regression in
 * `enforceCsrfForStateChange` or `enforceLoginRateLimit` would still
 * be caught here.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { createHash } from "node:crypto";

import { buildGateway } from "../../src/main.js";
import type { GatewayServices } from "../../src/services/composeServices.js";
import type { GatewayEnv } from "../../src/env.js";
import type { LoginService } from "../../../../packages/secure_core/src/auth/loginService.js";
import type {
  AuthenticateOutcome,
  AuthenticatePasswordInput,
  TerminateSessionInput,
} from "../../../../packages/secure_core/src/auth/loginService.js";
import { BootstrapService } from "../../../../packages/secure_core/src/bootstrap/service.js";
import type { BootstrapDbAdapter } from "../../../../packages/secure_core/src/bootstrap/service.js";
import { FakeWormMarkerProvider } from "../../../../packages/secure_core/src/bootstrap/wormMarker.js";
import type { SqlCurrentSessionReader } from "../../../../packages/secure_core/src/auth/sessionService.js";
import type {
  CurrentSessionAuth,
  CurrentSessionResponse,
} from "../../../../packages/secure_core/src/auth/sessionService.js";
import type { SecureCorePool } from "../../../../packages/secure_core/src/db/pool.js";
import type { AuditLogger } from "../../../../packages/secure_core/src/audit/logger.js";
import * as schema from "../../../../packages/secure_core/src/db/schema.js";

// ---------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------

const FRONTEND_ORIGIN = "http://localhost:3000";
const ROOT_ADMIN_USERNAME = "rootadmin42x9k";
const ROOT_ADMIN_PASSWORD = "supersecret-password-1234";
const OOB_CREDENTIAL = "open-sesame-bootstrap-2026";

const ADMIN_USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const RAW_SESSION_TOKEN =
  "raw_session_token_xyz_definitely_not_a_real_token_value";
const RAW_CSRF_TOKEN = "raw_csrf_token_abc_definitely_not_a_real_value";
const PLATFORM_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const INTERNAL_TOOLS_WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";

// ---------------------------------------------------------------------
// Stub builders
// ---------------------------------------------------------------------

function makeStubAuditLogger(): {
  logger: AuditLogger;
  calls: Array<{ action: string; result: string }>;
} {
  const calls: Array<{ action: string; result: string }> = [];
  const logger = {
    async write(input: { action: string; result: string }) {
      calls.push({ action: input.action, result: input.result });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

function makeStubLoginService(opts: {
  readonly outcome: AuthenticateOutcome;
}): {
  service: LoginService;
  authCalls: AuthenticatePasswordInput[];
  terminateCalls: TerminateSessionInput[];
} {
  const authCalls: AuthenticatePasswordInput[] = [];
  const terminateCalls: TerminateSessionInput[] = [];
  const service = {
    async authenticatePassword(input: AuthenticatePasswordInput) {
      authCalls.push(input);
      return opts.outcome;
    },
    async terminateSession(input: TerminateSessionInput) {
      terminateCalls.push(input);
    },
  } as unknown as LoginService;
  return { service, authCalls, terminateCalls };
}

function makeStubSessionReader(opts: {
  readonly response: CurrentSessionResponse;
}): {
  reader: SqlCurrentSessionReader;
  calls: CurrentSessionAuth[];
} {
  const calls: CurrentSessionAuth[] = [];
  const reader = {
    async getCurrentSession(auth: CurrentSessionAuth) {
      calls.push(auth);
      return opts.response;
    },
  } as unknown as SqlCurrentSessionReader;
  return { reader, calls };
}

/**
 * No-op postgres-js client. The smoke test never actually hits the DB
 * — every service that would touch it is stubbed at the service layer.
 * This `Sql` exists only so `SecureCorePool.sql` is non-null when the
 * unauthenticated `requireAuth` path checks for the cookie's absence.
 */
function makeNoopSql(): Sql {
  const taggedFn = (async () => []) as unknown as Sql;
  const augment = taggedFn as unknown as Record<string, unknown>;
  augment.unsafe = async () => [];
  augment.begin = async (fn: (tx: Sql) => Promise<unknown>) => fn(taggedFn);
  augment.end = async () => undefined;
  // Drizzle's `drizzle(sql)` factory reads `sql.options.parsers` at
  // construction time. The smoke test never lets a route hit a real
  // DB code path, so a no-op options map is sufficient — but the
  // field has to exist or `drizzle(sql)` throws at fixture build.
  augment.options = { parsers: {}, serializers: {} };
  return taggedFn;
}

// ---------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------

interface VerticalFixture {
  gateway: Awaited<ReturnType<typeof buildGateway>>;
  audit: ReturnType<typeof makeStubAuditLogger>;
  login: ReturnType<typeof makeStubLoginService>;
  session: ReturnType<typeof makeStubSessionReader>;
  bootstrap: {
    db: BootstrapDbAdapter;
    insertedUsernames: string[];
  };
  marker: FakeWormMarkerProvider;
}

async function buildFixture(opts: {
  readonly bootstrapAllowed?: string;
} = {}): Promise<VerticalFixture> {
  const audit = makeStubAuditLogger();

  // Build the OOB hash matching OOB_CREDENTIAL so the bootstrap
  // credential check accepts it exactly.
  const oobHashHex = createHash("sha256")
    .update(OOB_CREDENTIAL, "utf-8")
    .digest("hex");

  // Bootstrap stub adapter — flips state on insert so a second
  // attempt fails the WORM marker re-check.
  let adminExists = false;
  const insertedUsernames: string[] = [];
  const dbAdapter: BootstrapDbAdapter = {
    async platformAdminExists() {
      return adminExists;
    },
    async insertPlatformAdmin(args) {
      insertedUsernames.push(args.username);
      adminExists = true;
      return { adminUserId: ADMIN_USER_ID };
    },
  };

  const marker = new FakeWormMarkerProvider();
  const bootstrapService = new BootstrapService({
    db: dbAdapter,
    wormMarker: marker,
    auditLogger: audit.logger,
    credentialHashHex: oobHashHex,
  });

  const login = makeStubLoginService({
    outcome: {
      userId: ADMIN_USER_ID,
      sessionId: SESSION_ID,
      assuranceLevel: "aal2",
      rawSessionToken: RAW_SESSION_TOKEN,
      rawCsrfToken: RAW_CSRF_TOKEN,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });

  const session = makeStubSessionReader({
    response: {
      user_id: ADMIN_USER_ID,
      session_id: SESSION_ID,
      actor_type: "human",
      assurance_level: "aal2",
      memberships: [
        {
          workspace_id: PLATFORM_WORKSPACE_ID,
          workspace_name: "_platform",
          role_id: "9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad",
          role_name: "IncidentRemediator",
          capabilities: [
            "platform:audit_read",
            "platform:incident_remediate",
            "session:revoke",
            "user:disable",
          ],
        },
        {
          workspace_id: INTERNAL_TOOLS_WORKSPACE_ID,
          workspace_name: "shared-internal-tools",
          role_id: "5b807f69-df63-5054-a96a-490c9668a567",
          role_name: "WorkspaceAdmin",
          capabilities: [],
        },
      ],
    },
  });

  // SecureCorePool wrappers around the no-op Sql. Drizzle is
  // instantiated against the no-op client; the test never lets the
  // route hit a code path that would query through it.
  const appSql = makeNoopSql();
  const auditSql = makeNoopSql();
  const appPool: SecureCorePool = {
    role: "app",
    sql: appSql,
    db: drizzle(appSql, { schema }),
    async close() {},
  };
  const auditPool: SecureCorePool = {
    role: "app",
    sql: auditSql,
    db: drizzle(auditSql, { schema }),
    async close() {},
  };

  const services: GatewayServices = {
    appPool,
    auditPool,
    auditLogger: audit.logger,
    loginService: login.service,
    sessionReader: session.reader,
    bootstrapService,
    wormMarker: marker,
  };

  const env: GatewayEnv = {
    bootstrapAllowed: opts.bootstrapAllowed ?? "1",
    bootstrapCredentialHash: oobHashHex,
    rootAdminUserId: ROOT_ADMIN_USERNAME,
    gatewayPort: 4000,
    backendPort: 8000,
    cookieSecret: "x".repeat(64),
    handoffSecret: "y".repeat(64),
    frontendOrigin: FRONTEND_ORIGIN,
    dbUrl: "postgres://stub",
    dbAuditUrl: "postgres://stub",
    trustProxy: undefined,
    bootstrapWormProvider: "fake",
    bootstrapWormS3Bucket: undefined,
    bootstrapWormS3Key: undefined,
    bootstrapWormS3Region: undefined,
  };

  const gateway = await buildGateway({
    env,
    services,
    cookieSecure: false, // app.inject runs over plain HTTP
  });

  return {
    gateway,
    audit,
    login,
    session,
    bootstrap: { db: dbAdapter, insertedUsernames },
    marker,
  };
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe("workbench-gateway auth vertical (D + E1 wiring)", () => {
  let fx: VerticalFixture;

  beforeEach(async () => {
    fx = await buildFixture();
  });

  afterEach(async () => {
    await fx.gateway.close();
  });

  it("POST /bootstrap with matching OOB credential returns 201 + admin_user_id", async () => {
    const r = await fx.gateway.app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: {
        origin: FRONTEND_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        admin_username: ROOT_ADMIN_USERNAME,
        admin_password: ROOT_ADMIN_PASSWORD,
        oob_credential: OOB_CREDENTIAL,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ admin_user_id: ADMIN_USER_ID });
    expect(fx.bootstrap.insertedUsernames).toContain(ROOT_ADMIN_USERNAME);
  });

  it("second /bootstrap call after success returns 404 (WORM re-check)", async () => {
    const first = await fx.gateway.app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: {
        origin: FRONTEND_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        admin_username: ROOT_ADMIN_USERNAME,
        admin_password: ROOT_ADMIN_PASSWORD,
        oob_credential: OOB_CREDENTIAL,
      },
    });
    expect(first.statusCode).toBe(201);

    const second = await fx.gateway.app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: {
        origin: FRONTEND_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        admin_username: ROOT_ADMIN_USERNAME,
        admin_password: ROOT_ADMIN_PASSWORD,
        oob_credential: OOB_CREDENTIAL,
      },
    });
    expect(second.statusCode).toBe(404);
  });

  it("POST /auth/login mints both cookies and returns the canonical body", async () => {
    const r = await fx.gateway.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        origin: FRONTEND_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        username: ROOT_ADMIN_USERNAME,
        password: ROOT_ADMIN_PASSWORD,
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      user_id: ADMIN_USER_ID,
      session_id: SESSION_ID,
      assurance_level: "aal2",
      csrf_token: RAW_CSRF_TOKEN,
    });

    const setCookies = r.headers["set-cookie"];
    const cookies = Array.isArray(setCookies) ? setCookies : [setCookies ?? ""];
    const sessionCookie = cookies.find((c) =>
      c.startsWith("secure_session="),
    );
    const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
    expect(sessionCookie).toBeDefined();
    expect(csrfCookie).toBeDefined();
    expect(sessionCookie!.toLowerCase()).toContain("httponly");
    // CSRF cookie MUST NOT be HttpOnly — the SPA reads it via JS.
    expect(csrfCookie!.toLowerCase()).not.toContain("httponly");

    expect(fx.login.authCalls).toHaveLength(1);
    expect(fx.login.authCalls[0]!.username).toBe(ROOT_ADMIN_USERNAME);
  });

  it("GET /auth/session without a cookie returns 401", async () => {
    const r = await fx.gateway.app.inject({
      method: "GET",
      url: "/auth/session",
    });
    expect(r.statusCode).toBe(401);
    // The session reader was never called — requireAuth short-
    // circuited at the cookie-presence check.
    expect(fx.session.calls).toHaveLength(0);
  });

  it("/auth/login wrong Origin → 403 (Origin mismatch)", async () => {
    const r = await fx.gateway.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        origin: "https://attacker.example.com",
        "content-type": "application/json",
      },
      payload: {
        username: ROOT_ADMIN_USERNAME,
        password: ROOT_ADMIN_PASSWORD,
      },
    });
    expect(r.statusCode).toBe(403);
    // The login service was never invoked — the CSRF guard fired
    // first.
    expect(fx.login.authCalls).toHaveLength(0);
  });

  it("/auth/login schema rejects forbidden body field (actor_user_id)", async () => {
    const r = await fx.gateway.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        origin: FRONTEND_ORIGIN,
        "content-type": "application/json",
      },
      payload: {
        username: ROOT_ADMIN_USERNAME,
        password: ROOT_ADMIN_PASSWORD,
        // §4.1 forbidden field — the schema's
        // `additionalProperties: false` MUST refuse this.
        actor_user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      },
    });
    expect(r.statusCode).toBe(400);
    expect(fx.login.authCalls).toHaveLength(0);
  });
});

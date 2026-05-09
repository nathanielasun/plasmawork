/**
 * Login + logout route tests — Phase 0.5 audit fix F1+F2 (2026-05-09).
 *
 * Pins:
 *   - POST /auth/login mints `secure_session` (HttpOnly) AND
 *     `csrf_token` (non-HttpOnly) cookies; returns the user/session
 *     ids + raw CSRF token in the body. Raw session token NEVER
 *     appears in the body.
 *   - POST /auth/login is rate-limited (per-IP) and Origin-checked
 *     before the schema validator runs.
 *   - Schema is `additionalProperties: false`; forbidden-body scan
 *     refuses fields like `actor_user_id`.
 *   - All authentication failures return the same generic 401 body.
 *   - POST /auth/logout requires auth, revokes the session, and
 *     ALWAYS clears both cookies — even if revocation fails.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";

import {
  loginRoutes,
  type LoginRoutesMiddleware,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  LOGIN_SCHEMA,
  LOGOUT_SCHEMA,
} from "../../src/routes/login.js";
import {
  LoginService,
  type AuthenticateOutcome,
} from "../../src/auth/loginService.js";
import { enforceRateLimit, InMemoryRateLimitStore } from "../../src/middleware/enforceRateLimit.js";
import { enforceCsrfForStateChange } from "../../src/middleware/enforceCsrfForStateChange.js";
import { validateInputSchema } from "../../src/middleware/validateInputSchema.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import {
  SecureCoreError,
  UnauthenticatedError,
} from "../../src/errors/shapes.js";
import type { NamedMiddleware } from "../../src/middleware/compose.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { AuthContext } from "../../src/middleware/types.js";
import "../../src/middleware/fastify_augment.js";

const ALLOWED_ORIGIN = "https://app.plasmawork.test";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

interface AuditCall {
  action: string;
  result: string;
  actorUserId: string | null;
  actorType: string;
  metadata?: Record<string, unknown>;
}

function makeStubAuditLogger(): {
  logger: AuditLogger;
  calls: AuditCall[];
} {
  const calls: AuditCall[] = [];
  const logger = {
    async write(input: {
      action: string;
      result: string;
      actorUserId: string | null;
      actorType: string;
      metadata?: Record<string, unknown>;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        actorUserId: input.actorUserId,
        actorType: input.actorType,
        metadata: input.metadata,
      });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

interface LoginStubOpts {
  readonly outcome?: AuthenticateOutcome;
  readonly authError?: SecureCoreError;
  readonly terminateError?: SecureCoreError | Error;
}

function makeStubService(opts: LoginStubOpts = {}): {
  service: LoginService;
  authCalls: Array<{ email: string; password: string; requestId: string }>;
  terminateCalls: Array<{ sessionId: string; actorUserId: string }>;
} {
  const authCalls: Array<{ email: string; password: string; requestId: string }> = [];
  const terminateCalls: Array<{ sessionId: string; actorUserId: string }> = [];
  const service = {
    async authenticatePassword(input: {
      email: string;
      password: string;
      requestId: string;
    }) {
      authCalls.push(input);
      if (opts.authError !== undefined) {
        throw opts.authError;
      }
      if (opts.outcome === undefined) {
        throw new UnauthenticatedError("Invalid email or password.");
      }
      return opts.outcome;
    },
    async terminateSession(input: { sessionId: string; actorUserId: string }) {
      terminateCalls.push(input);
      if (opts.terminateError !== undefined) {
        throw opts.terminateError;
      }
    },
  } as unknown as LoginService;
  return { service, authCalls, terminateCalls };
}

interface MwOpts {
  readonly authed?: boolean;
}

function buildLoginMiddleware(
  audit: AuditLogger,
  rateStore: InMemoryRateLimitStore,
  opts: MwOpts = {},
): LoginRoutesMiddleware {
  const enforceLoginRateLimit = enforceRateLimit({
    limit: 100,
    windowMs: 60_000,
    store: rateStore,
    auditLogger: audit,
    endpoint: "auth.login",
  });
  const enforceCsrf = enforceCsrfForStateChange({
    auditLogger: audit,
    allowedOrigins: [ALLOWED_ORIGIN],
  });
  const validateLogin = validateInputSchema(LOGIN_SCHEMA, {
    auditLogger: audit,
  });
  const validateLogout = validateInputSchema(LOGOUT_SCHEMA, {
    auditLogger: audit,
  });

  const requireAuth: NamedMiddleware = {
    name: "requireAuth",
    handler: async (req: FastifyRequest) => {
      if (opts.authed === false) {
        throw new SecureCoreError("UNAUTHENTICATED", "no auth");
      }
      const auth: AuthContext = {
        userId: USER_ID,
        sessionId: SESSION_ID,
        actorType: "human",
        assuranceLevel: "aal2",
      };
      req.auth = auth;
    },
  };
  const attachAuditActor: NamedMiddleware = {
    name: "attachAuditActor",
    handler: async (req: FastifyRequest) => {
      req.audit = {
        actorUserId: req.auth?.userId ?? null,
        actorType: req.auth?.actorType ?? "unauthenticated",
        requestId: req.requestId,
      };
    },
  };

  return {
    enforceLoginRateLimit,
    enforceCsrfForStateChange: enforceCsrf,
    validateInputSchemaLogin: validateLogin,
    validateInputSchemaLogout: validateLogout,
    requireAuth,
    attachAuditActor,
  };
}

async function buildApp(args: {
  audit: AuditLogger;
  service: LoginService;
  authed?: boolean;
  rateStore?: InMemoryRateLimitStore;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.addHook("onRequest", requireRequestId);
  app.setErrorHandler((err, req, reply) => {
    const fErr = err as Error & {
      statusCode?: number;
      validation?: unknown;
    };
    if (
      typeof fErr.statusCode === "number" &&
      fErr.statusCode === 400 &&
      fErr.validation !== undefined
    ) {
      reply.code(400).send({
        error: {
          code: "INPUT_INVALID",
          message: "Schema validation failed.",
          request_id: req.requestId ?? "unknown",
        },
      });
      return;
    }
    const mapped = toHttpResponse(err, req.requestId ?? "unknown");
    reply.code(mapped.status).send(mapped.body);
  });

  const rateStore = args.rateStore ?? new InMemoryRateLimitStore();
  const mw = buildLoginMiddleware(args.audit, rateStore, {
    authed: args.authed,
  });
  await app.register(loginRoutes, {
    service: args.service,
    mw,
    cookieSecure: false, // Tests run on plain HTTP
  });
  return app;
}

const goodHeaders = {
  origin: ALLOWED_ORIGIN,
  "content-type": "application/json",
};

const happyOutcome: AuthenticateOutcome = {
  userId: USER_ID,
  sessionId: SESSION_ID,
  assuranceLevel: "aal2",
  rawSessionToken: "raw_session_token_xyz_definitely_not_a_real_token",
  rawCsrfToken: "raw_csrf_token_abc_definitely_not_a_real_token",
  expiresAt: new Date("2026-05-10T00:00:00Z"),
};

describe("loginRoutes — POST /auth/login (F1+F2)", () => {
  let audit: ReturnType<typeof makeStubAuditLogger>;

  beforeEach(() => {
    audit = makeStubAuditLogger();
  });

  it("happy path mints both cookies and returns body without raw session token", async () => {
    const stub = makeStubService({ outcome: happyOutcome });
    const app = await buildApp({ audit: audit.logger, service: stub.service });

    const r = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: goodHeaders,
      payload: { email: "alice@example.com", password: "supersecret" },
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      user_id: USER_ID,
      session_id: SESSION_ID,
      assurance_level: "aal2",
      csrf_token: happyOutcome.rawCsrfToken,
      expires_at: "2026-05-10T00:00:00.000Z",
    });
    // Body MUST NOT contain the raw session token.
    expect(JSON.stringify(body)).not.toContain(happyOutcome.rawSessionToken);

    // Two Set-Cookie headers; one HttpOnly (session) and one not (CSRF).
    const setCookies = r.headers["set-cookie"];
    const cookies = Array.isArray(setCookies) ? setCookies : [setCookies ?? ""];
    const sessionCookie = cookies.find((c) =>
      c.startsWith(`${SESSION_COOKIE_NAME}=`),
    );
    const csrfCookie = cookies.find((c) =>
      c.startsWith(`${CSRF_COOKIE_NAME}=`),
    );
    expect(sessionCookie).toBeDefined();
    expect(csrfCookie).toBeDefined();
    expect(sessionCookie).toContain(happyOutcome.rawSessionToken);
    expect(sessionCookie!.toLowerCase()).toContain("httponly");
    expect(sessionCookie!.toLowerCase()).toContain("samesite=lax");
    expect(csrfCookie).toContain(happyOutcome.rawCsrfToken);
    // CSRF cookie MUST NOT be HttpOnly (the SPA reads it).
    expect(csrfCookie!.toLowerCase()).not.toContain("httponly");
    expect(csrfCookie!.toLowerCase()).toContain("samesite=lax");

    expect(stub.authCalls).toHaveLength(1);
    expect(stub.authCalls[0].email).toBe("alice@example.com");
  });

  it("auth failure: returns generic 401 with no Set-Cookie headers", async () => {
    const stub = makeStubService({
      authError: new UnauthenticatedError("Invalid email or password."),
    });
    const app = await buildApp({ audit: audit.logger, service: stub.service });

    const r = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: goodHeaders,
      payload: { email: "alice@example.com", password: "wrong" },
    });

    expect(r.statusCode).toBe(401);
    const body = r.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.message).toBe("Invalid email or password.");
    // No cookies set on failure.
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects request without Origin (CSRF Origin check)", async () => {
    const stub = makeStubService({ outcome: happyOutcome });
    const app = await buildApp({ audit: audit.logger, service: stub.service });

    const r = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "alice@example.com", password: "supersecret" },
    });

    expect(r.statusCode).toBe(403);
    expect(stub.authCalls).toHaveLength(0);
  });

  it("rejects request from disallowed Origin", async () => {
    const stub = makeStubService({ outcome: happyOutcome });
    const app = await buildApp({ audit: audit.logger, service: stub.service });

    const r = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
      },
      payload: { email: "alice@example.com", password: "supersecret" },
    });

    expect(r.statusCode).toBe(403);
    expect(stub.authCalls).toHaveLength(0);
  });

  it("rejects body with extra field (additionalProperties: false)", async () => {
    const stub = makeStubService({ outcome: happyOutcome });
    const app = await buildApp({ audit: audit.logger, service: stub.service });

    const r = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: goodHeaders,
      payload: {
        email: "alice@example.com",
        password: "supersecret",
        wat: "extra",
      },
    });

    expect(r.statusCode).toBe(400);
    expect(stub.authCalls).toHaveLength(0);
  });

  it("rejects body with forbidden field (actor_user_id)", async () => {
    const stub = makeStubService({ outcome: happyOutcome });
    const app = await buildApp({ audit: audit.logger, service: stub.service });

    const r = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: goodHeaders,
      payload: {
        email: "alice@example.com",
        password: "supersecret",
        actor_user_id: USER_ID,
      },
    });

    expect(r.statusCode).toBe(400);
    expect(stub.authCalls).toHaveLength(0);
  });

  it("rejects body missing required fields", async () => {
    const stub = makeStubService({ outcome: happyOutcome });
    const app = await buildApp({ audit: audit.logger, service: stub.service });

    const r = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: goodHeaders,
      payload: { email: "alice@example.com" },
    });

    expect(r.statusCode).toBe(400);
    expect(stub.authCalls).toHaveLength(0);
  });
});

describe("loginRoutes — POST /auth/logout (F1+F2)", () => {
  let audit: ReturnType<typeof makeStubAuditLogger>;

  beforeEach(() => {
    audit = makeStubAuditLogger();
  });

  it("authenticated logout revokes session and clears both cookies (204)", async () => {
    const stub = makeStubService();
    const app = await buildApp({
      audit: audit.logger,
      service: stub.service,
      authed: true,
    });

    const r = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        ...goodHeaders,
        cookie: `${CSRF_COOKIE_NAME}=tkn`,
        "x-csrf-token": "tkn",
      },
      payload: {},
    });

    expect(r.statusCode).toBe(204);
    expect(stub.terminateCalls).toHaveLength(1);
    expect(stub.terminateCalls[0]).toMatchObject({
      sessionId: SESSION_ID,
      actorUserId: USER_ID,
    });

    const setCookies = r.headers["set-cookie"];
    const cookies = Array.isArray(setCookies) ? setCookies : [setCookies ?? ""];
    // Both cookies cleared (Expires in the past or Max-Age=0).
    const sessionClear = cookies.find((c) =>
      c.startsWith(`${SESSION_COOKIE_NAME}=`),
    );
    const csrfClear = cookies.find((c) =>
      c.startsWith(`${CSRF_COOKIE_NAME}=`),
    );
    expect(sessionClear).toBeDefined();
    expect(csrfClear).toBeDefined();
  });

  it("logout without auth returns 401 and never calls terminateSession", async () => {
    const stub = makeStubService();
    const app = await buildApp({
      audit: audit.logger,
      service: stub.service,
      authed: false,
    });

    const r = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        ...goodHeaders,
        cookie: `${CSRF_COOKIE_NAME}=tkn`,
        "x-csrf-token": "tkn",
      },
      payload: {},
    });

    expect(r.statusCode).toBe(401);
    expect(stub.terminateCalls).toHaveLength(0);
  });

  it("logout still clears cookies on unknown error from terminateSession", async () => {
    const stub = makeStubService({
      terminateError: new Error("db unreachable"),
    });
    const app = await buildApp({
      audit: audit.logger,
      service: stub.service,
      authed: true,
    });

    const r = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        ...goodHeaders,
        cookie: `${CSRF_COOKIE_NAME}=tkn`,
        "x-csrf-token": "tkn",
      },
      payload: {},
    });

    // Unknown error is swallowed so the client always lands cookie-less.
    expect(r.statusCode).toBe(204);
    const setCookies = r.headers["set-cookie"];
    const cookies = Array.isArray(setCookies) ? setCookies : [setCookies ?? ""];
    expect(
      cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)),
    ).toBeDefined();
    expect(
      cookies.find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`)),
    ).toBeDefined();
  });

  it("logout propagates SecureCoreError from terminateSession (e.g. NOT_FOUND)", async () => {
    const stub = makeStubService({
      terminateError: new SecureCoreError("NOT_FOUND", "Session not found."),
    });
    const app = await buildApp({
      audit: audit.logger,
      service: stub.service,
      authed: true,
    });

    const r = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        ...goodHeaders,
        cookie: `${CSRF_COOKIE_NAME}=tkn`,
        "x-csrf-token": "tkn",
      },
      payload: {},
    });

    expect(r.statusCode).toBe(404);
  });

  it("logout rejects body with extra fields", async () => {
    const stub = makeStubService();
    const app = await buildApp({
      audit: audit.logger,
      service: stub.service,
      authed: true,
    });

    const r = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        ...goodHeaders,
        cookie: `${CSRF_COOKIE_NAME}=tkn`,
        "x-csrf-token": "tkn",
      },
      payload: { wat: "extra" },
    });

    expect(r.statusCode).toBe(400);
    expect(stub.terminateCalls).toHaveLength(0);
  });
});

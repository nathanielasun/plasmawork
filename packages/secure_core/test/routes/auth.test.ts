/**
 * L4.8 — recovery flow route + service tests.
 *
 * Pure-logic. Stubs the `RecoveryRepo`, `EmailSender`, and AuditLogger
 * (in-memory writer) so the full flow exercises route → service →
 * repo without touching Postgres. Per-IP rate-limit middleware uses
 * the real `enforceRateLimit` factory + `InMemoryRateLimitStore`;
 * the per-email path runs inside the service against the same store.
 *
 * The middleware bundle is composed exactly as the host would compose
 * it (rate limit → CSRF → input schema), so these tests pin both the
 * §6.2 ordering and the bypass-resistance of the route-level checks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

import {
  authRoutes,
  REQUEST_USERNAME_SCHEMA,
  PASSWORD_RESET_CONSUME_SCHEMA,
  EMAIL_VERIFY_CONSUME_SCHEMA,
  MFA_RECOVERY_SCHEMA,
  type AuthRoutesMiddleware,
} from "../../src/routes/auth.js";
import {
  RecoveryService,
  type RecoveryRepo,
  type ConsumeOutcome,
} from "../../src/auth/recoveryService.js";
import { StubEmailSender } from "../../src/auth/emailSender.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { enforceRateLimit, InMemoryRateLimitStore } from "../../src/middleware/enforceRateLimit.js";
import { enforceCsrfForStateChange } from "../../src/middleware/enforceCsrfForStateChange.js";
import { validateInputSchema } from "../../src/middleware/validateInputSchema.js";
import {
  AuditLogger,
  type PreparedAuditRow,
} from "../../src/audit/logger.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import { hashToken, mintToken } from "../../src/crypto/tokens.js";

const KNOWN_USER_ID = "11111111-1111-4111-8111-111111111111";
const KNOWN_USERNAME = "alice_42";
const KNOWN_EMAIL = "user@example.com";
const ALLOWED_ORIGIN = "https://app.plasmawork.test";

interface AuditHarness {
  logger: AuditLogger;
  rows: PreparedAuditRow[];
}

function makeAuditHarness(): AuditHarness {
  let prevHash: string | null = null;
  const rows: PreparedAuditRow[] = [];
  const logger = new AuditLogger({
    writer: async (row) => {
      rows.push(row);
      prevHash = row.row_hash;
    },
    prevHashGetter: async () => prevHash,
  });
  return { logger, rows };
}

interface RepoState {
  passwordResetTokens: Map<string, { userId: string; expiresAt: Date; used: boolean }>;
  emailVerificationTokens: Map<
    string,
    { userId: string; email: string; expiresAt: Date; used: boolean }
  >;
  passwordResetsApplied: Array<{ userId: string; newPassword: string }>;
}

interface RepoHarness {
  repo: RecoveryRepo;
  state: RepoState;
}

function makeRepo(opts?: {
  knownUsernames?: Map<string, { userId: string; email: string | null }>;
}): RepoHarness {
  const known =
    opts?.knownUsernames ??
    new Map([[KNOWN_USERNAME, { userId: KNOWN_USER_ID, email: KNOWN_EMAIL }]]);
  const state: RepoState = {
    passwordResetTokens: new Map(),
    emailVerificationTokens: new Map(),
    passwordResetsApplied: [],
  };
  const repo: RecoveryRepo = {
    async findUserByUsername(username) {
      return known.get(username) ?? null;
    },
    async insertPasswordResetToken(args) {
      state.passwordResetTokens.set(args.tokenHash, {
        userId: args.userId,
        expiresAt: args.expiresAt,
        used: false,
      });
    },
    async insertEmailVerificationToken(args) {
      state.emailVerificationTokens.set(args.tokenHash, {
        userId: args.userId,
        email: args.email,
        expiresAt: args.expiresAt,
        used: false,
      });
    },
    async consumePasswordResetToken(tokenHash): Promise<ConsumeOutcome> {
      const row = state.passwordResetTokens.get(tokenHash);
      if (row === undefined) return { consumed: false, userId: null };
      if (row.used) return { consumed: false, userId: null };
      if (row.expiresAt.getTime() <= Date.now()) {
        return { consumed: false, userId: null };
      }
      row.used = true;
      return { consumed: true, userId: row.userId };
    },
    async consumeEmailVerificationToken(tokenHash): Promise<ConsumeOutcome> {
      const row = state.emailVerificationTokens.get(tokenHash);
      if (row === undefined) return { consumed: false, userId: null };
      if (row.used) return { consumed: false, userId: null };
      if (row.expiresAt.getTime() <= Date.now()) {
        return { consumed: false, userId: null };
      }
      row.used = true;
      return { consumed: true, userId: row.userId };
    },
    async applyPasswordReset(args) {
      state.passwordResetsApplied.push(args);
    },
  };
  return { repo, state };
}

interface AppHarness {
  app: FastifyInstance;
  audit: AuditHarness;
  repoHarness: RepoHarness;
  emailSender: StubEmailSender;
  rateStore: InMemoryRateLimitStore;
  service: RecoveryService;
  /**
   * Captured mintSessionForUser calls from the stub login service.
   * The legacy tests that drove the consume happy-path assertion
   * inspect this so they can prove the bridge fired (or didn't, on
   * sad paths).
   */
  mintCalls: Array<{
    userId: string;
    authMethod: string;
    assuranceLevel: string;
  }>;
}

function buildApp(opts?: {
  knownUsernames?: Map<string, { userId: string; email: string | null }>;
}): AppHarness {
  const audit = makeAuditHarness();
  const repoHarness = makeRepo(opts);
  const emailSender = new StubEmailSender();
  const rateStore = new InMemoryRateLimitStore();
  const mintCalls: AppHarness["mintCalls"] = [];

  const service = new RecoveryService({
    repo: repoHarness.repo,
    emailSender,
    auditLogger: audit.logger,
    rateLimitStore: rateStore,
    frontendOrigin: ALLOWED_ORIGIN,
  });

  const loginService = {
    async mintSessionForUser(input: {
      userId: string;
      authMethod: string;
      assuranceLevel: string;
      requestId: string;
    }) {
      mintCalls.push({
        userId: input.userId,
        authMethod: input.authMethod,
        assuranceLevel: input.assuranceLevel,
      });
      return {
        userId: input.userId,
        sessionId: `sess-${input.authMethod}`,
        assuranceLevel: input.assuranceLevel as "aal1" | "aal2" | "aal3",
        rawSessionToken: `raw_session_${input.authMethod}`,
        rawCsrfToken: `raw_csrf_${input.authMethod}`,
        expiresAt: new Date("2026-05-10T00:00:00Z"),
      };
    },
  } as unknown as import("../../src/auth/loginService.js").LoginService;

  const mw: AuthRoutesMiddleware = {
    enforceRateLimit: enforceRateLimit({
      limit: 100,
      windowMs: 60_000,
      store: rateStore,
      auditLogger: audit.logger,
      endpoint: "auth.recovery",
    }),
    enforceCsrfForStateChange: enforceCsrfForStateChange({
      auditLogger: audit.logger,
      allowedOrigins: [ALLOWED_ORIGIN],
    }),
    validateInputSchemaPasswordResetRequest: validateInputSchema(
      REQUEST_USERNAME_SCHEMA,
      { auditLogger: audit.logger },
    ),
    validateInputSchemaPasswordResetConsume: validateInputSchema(
      PASSWORD_RESET_CONSUME_SCHEMA,
      { auditLogger: audit.logger },
    ),
    validateInputSchemaEmailVerifyRequest: validateInputSchema(
      REQUEST_USERNAME_SCHEMA,
      { auditLogger: audit.logger },
    ),
    validateInputSchemaEmailVerifyConsume: validateInputSchema(
      EMAIL_VERIFY_CONSUME_SCHEMA,
      { auditLogger: audit.logger },
    ),
    validateInputSchemaMfaRecovery: validateInputSchema(MFA_RECOVERY_SCHEMA, {
      auditLogger: audit.logger,
    }),
  };

  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
        useDefaults: false,
        coerceTypes: false,
        allErrors: false,
        strict: false,
      },
    },
  });
  void app.register(import("@fastify/cookie"));
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
    const mapped = toHttpResponse(
      err instanceof SecureCoreError ? err : err,
      req.requestId ?? "unknown",
    );
    reply.code(mapped.status).send(mapped.body);
  });
  app.register(authRoutes, { service, mw, loginService, cookieSecure: false });

  return {
    app,
    audit,
    repoHarness,
    emailSender,
    rateStore,
    service,
    mintCalls,
  };
}

const goodHeaders = {
  origin: ALLOWED_ORIGIN,
  "content-type": "application/json",
};

// =====================================================================
// Tests
// =====================================================================

describe("L4.8 — recovery routes", () => {
  let h: AppHarness;
  beforeEach(() => {
    h = buildApp();
  });

  // -----------------------------------------------------------------
  // request endpoints — anti-enumeration shape parity
  // -----------------------------------------------------------------

  it("POST /auth/password-reset/request returns 202 for a known username", async () => {
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      headers: goodHeaders,
      payload: { username: KNOWN_USERNAME },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json() as { status: string };
    expect(body.status).toBe("accepted");
    expect(h.emailSender.passwordResetCalls).toHaveLength(1);
    expect(h.emailSender.passwordResetCalls[0]!.toEmail).toBe(KNOWN_EMAIL);
    // Token was inserted; one row in the password_reset_tokens stub.
    expect(h.repoHarness.state.passwordResetTokens.size).toBe(1);
  });

  it("POST /auth/password-reset/request returns 202 for an unknown username (same shape)", async () => {
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      headers: goodHeaders,
      payload: { username: "nobody_here" },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json() as { status: string; message: string };
    expect(body.status).toBe("accepted");
    // No email sent, no token row stored — but the response is byte-identical
    // to the known-email branch.
    expect(h.emailSender.passwordResetCalls).toHaveLength(0);
    expect(h.repoHarness.state.passwordResetTokens.size).toBe(0);
  });

  // -----------------------------------------------------------------
  // password-reset/consume happy + sad paths
  // -----------------------------------------------------------------

  it("POST /auth/password-reset/consume happy path", async () => {
    const rawToken = mintToken();
    const tokenHash = hashToken(rawToken);
    h.repoHarness.state.passwordResetTokens.set(tokenHash, {
      userId: KNOWN_USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
      used: false,
    });

    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/consume",
      headers: goodHeaders,
      payload: { token: rawToken, new_password: "correct horse battery" },
    });
    expect(r.statusCode).toBe(200);
    expect(h.repoHarness.state.passwordResetsApplied).toEqual([
      { userId: KNOWN_USER_ID, newPassword: "correct horse battery" },
    ]);
    // Single-use: row marked used.
    expect(h.repoHarness.state.passwordResetTokens.get(tokenHash)?.used).toBe(true);
  });

  it("POST /auth/password-reset/consume invalid token → 400 generic message", async () => {
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/consume",
      headers: goodHeaders,
      payload: { token: "wrong-token-value", new_password: "correct horse battery" },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INPUT_INVALID");
    expect(body.error.message).toBe("Token invalid or expired.");
    expect(h.repoHarness.state.passwordResetsApplied).toHaveLength(0);
    // login.failed audit row emitted with denied_reason
    const loginFailed = h.audit.rows.find(
      (row) => row.action === "login.failed",
    );
    expect(loginFailed).toBeDefined();
    expect((loginFailed!.metadata as Record<string, unknown>).denied_reason).toBe(
      "invalid_or_expired",
    );
  });

  it("POST /auth/password-reset/consume expired token → 400 same generic message", async () => {
    const rawToken = mintToken();
    const tokenHash = hashToken(rawToken);
    h.repoHarness.state.passwordResetTokens.set(tokenHash, {
      userId: KNOWN_USER_ID,
      expiresAt: new Date(Date.now() - 60_000), // expired one minute ago
      used: false,
    });

    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/consume",
      headers: goodHeaders,
      payload: { token: rawToken, new_password: "correct horse battery" },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; message: string } };
    expect(body.error.message).toBe("Token invalid or expired.");
    // Row not marked used; the atomic UPDATE refused it.
    expect(h.repoHarness.state.passwordResetTokens.get(tokenHash)?.used).toBe(false);
    expect(h.repoHarness.state.passwordResetsApplied).toHaveLength(0);
  });

  it("POST /auth/password-reset/consume used token → 400 same generic message (reuse refused)", async () => {
    const rawToken = mintToken();
    const tokenHash = hashToken(rawToken);
    h.repoHarness.state.passwordResetTokens.set(tokenHash, {
      userId: KNOWN_USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
      used: true, // already consumed once
    });

    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/consume",
      headers: goodHeaders,
      payload: { token: rawToken, new_password: "correct horse battery" },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { message: string } };
    expect(body.error.message).toBe("Token invalid or expired.");
    expect(h.repoHarness.state.passwordResetsApplied).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // email-verify request + consume
  // -----------------------------------------------------------------

  it("POST /auth/email-verify/request returns 202", async () => {
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/email-verify/request",
      headers: goodHeaders,
      payload: { username: KNOWN_USERNAME },
    });
    expect(r.statusCode).toBe(202);
    expect(h.emailSender.emailVerificationCalls).toHaveLength(1);
    expect(h.repoHarness.state.emailVerificationTokens.size).toBe(1);
  });

  it("POST /auth/email-verify/consume happy path", async () => {
    const rawToken = mintToken();
    const tokenHash = hashToken(rawToken);
    h.repoHarness.state.emailVerificationTokens.set(tokenHash, {
      userId: KNOWN_USER_ID,
      email: KNOWN_EMAIL,
      expiresAt: new Date(Date.now() + 60_000),
      used: false,
    });

    const r = await h.app.inject({
      method: "POST",
      url: "/auth/email-verify/consume",
      headers: goodHeaders,
      payload: { token: rawToken },
    });
    expect(r.statusCode).toBe(200);
    expect(
      h.repoHarness.state.emailVerificationTokens.get(tokenHash)?.used,
    ).toBe(true);
  });

  // -----------------------------------------------------------------
  // mfa-recovery — stub
  // -----------------------------------------------------------------

  it("POST /auth/mfa-recovery returns the stub-pending-review response", async () => {
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/mfa-recovery",
      headers: goodHeaders,
      payload: { username: KNOWN_USERNAME, recovery_code: "code-123" },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json() as { status: string; message: string };
    expect(body.status).toBe("accepted");
    expect(body.message).toContain("operator review");
    // Audited as login.failed with denied_reason = mfa_recovery_pending_review.
    const loginFailed = h.audit.rows.find(
      (row) => row.action === "login.failed",
    );
    expect(loginFailed).toBeDefined();
    expect(
      (loginFailed!.metadata as Record<string, unknown>).denied_reason,
    ).toBe("mfa_recovery_pending_review");
    expect(loginFailed!.actor_type).toBe("unauthenticated");
    expect(loginFailed!.actor_user_id).toBeNull();
  });

  // -----------------------------------------------------------------
  // Hard-rule guards: reject forbidden body fields, missing Origin, etc.
  // -----------------------------------------------------------------

  it("POST /auth/password-reset/request refuses requests without an allowed Origin", async () => {
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      headers: { "content-type": "application/json" },
      payload: { username: KNOWN_USERNAME },
    });
    // Origin missing → ORIGIN_MISMATCH from L2.2.
    expect(r.statusCode).toBe(403);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("ORIGIN_MISMATCH");
  });

  it("POST /auth/password-reset/request refuses forbidden body field (user_id)", async () => {
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      headers: goodHeaders,
      payload: { username: KNOWN_USERNAME, user_id: KNOWN_USER_ID },
    });
    // The route schema is additionalProperties:false so Fastify's own
    // schema fires first with a 400 INPUT_INVALID. Either way the route
    // never sees the smuggled field — that's the contract.
    expect(r.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------
// Recovery → session bridge (Phase 0.5 audit fix, 2026-05-09)
//
// `AuthRoutesOptions.loginService` is required. The consume endpoints mint
// a fresh session and set `secure_session` / `csrf_token` cookies so the
// user lands logged in. The old "200 + { status: 'ok' }" no-cookie path
// is intentionally gone because it preserved a silent host-wiring bug.
// ---------------------------------------------------------------------

describe("L4.8 — recovery → session bridge", () => {
  interface BridgeHarness {
    app: FastifyInstance;
    audit: AuditHarness;
    repoHarness: RepoHarness;
    emailSender: StubEmailSender;
    rateStore: InMemoryRateLimitStore;
    service: RecoveryService;
    mintCalls: Array<{
      userId: string;
      authMethod: string;
      assuranceLevel: string;
    }>;
  }

  function buildBridgeApp(): BridgeHarness {
    const audit = makeAuditHarness();
    const repoHarness = makeRepo();
    const emailSender = new StubEmailSender();
    const rateStore = new InMemoryRateLimitStore();
    const service = new RecoveryService({
      repo: repoHarness.repo,
      emailSender,
      auditLogger: audit.logger,
      rateLimitStore: rateStore,
      frontendOrigin: ALLOWED_ORIGIN,
    });
    const mintCalls: BridgeHarness["mintCalls"] = [];
    const loginService = {
      async mintSessionForUser(input: {
        userId: string;
        authMethod: string;
        assuranceLevel: string;
        requestId: string;
      }) {
        mintCalls.push({
          userId: input.userId,
          authMethod: input.authMethod,
          assuranceLevel: input.assuranceLevel,
        });
        return {
          userId: input.userId,
          sessionId: `sess-${input.authMethod}`,
          assuranceLevel: input.assuranceLevel as "aal1" | "aal2" | "aal3",
          rawSessionToken: `raw_session_${input.authMethod}`,
          rawCsrfToken: `raw_csrf_${input.authMethod}`,
          expiresAt: new Date("2026-05-10T00:00:00Z"),
        };
      },
    } as unknown as import("../../src/auth/loginService.js").LoginService;

    const mw: AuthRoutesMiddleware = {
      enforceRateLimit: enforceRateLimit({
        limit: 100,
        windowMs: 60_000,
        store: rateStore,
        auditLogger: audit.logger,
        endpoint: "auth.recovery",
      }),
      enforceCsrfForStateChange: enforceCsrfForStateChange({
        auditLogger: audit.logger,
        allowedOrigins: [ALLOWED_ORIGIN],
      }),
      validateInputSchemaPasswordResetRequest: validateInputSchema(
        REQUEST_USERNAME_SCHEMA,
        { auditLogger: audit.logger },
      ),
      validateInputSchemaPasswordResetConsume: validateInputSchema(
        PASSWORD_RESET_CONSUME_SCHEMA,
        { auditLogger: audit.logger },
      ),
      validateInputSchemaEmailVerifyRequest: validateInputSchema(
        REQUEST_USERNAME_SCHEMA,
        { auditLogger: audit.logger },
      ),
      validateInputSchemaEmailVerifyConsume: validateInputSchema(
        EMAIL_VERIFY_CONSUME_SCHEMA,
        { auditLogger: audit.logger },
      ),
      validateInputSchemaMfaRecovery: validateInputSchema(MFA_RECOVERY_SCHEMA, {
        auditLogger: audit.logger,
      }),
    };

    const app = Fastify({
      logger: false,
      ajv: {
        customOptions: {
          removeAdditional: false,
          useDefaults: false,
          coerceTypes: false,
          allErrors: false,
          strict: false,
        },
      },
    });
    void app.register(import("@fastify/cookie"));
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
    void app.register(authRoutes, {
      service,
      mw,
      loginService,
      cookieSecure: false,
    });
    return {
      app,
      audit,
      repoHarness,
      emailSender,
      rateStore,
      service,
      mintCalls,
    };
  }

  it("password-reset/consume happy path mints session + sets cookies", async () => {
    const h = buildBridgeApp();
    const rawToken = mintToken();
    h.repoHarness.state.passwordResetTokens.set(hashToken(rawToken), {
      userId: KNOWN_USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
      used: false,
    });

    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/consume",
      headers: goodHeaders,
      payload: {
        token: rawToken,
        new_password: "new_strong_password_123",
      },
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      user_id: KNOWN_USER_ID,
      session_id: "sess-password_reset",
      assurance_level: "aal2",
      csrf_token: "raw_csrf_password_reset",
    });
    expect(JSON.stringify(body)).not.toContain("raw_session_password_reset");

    const setCookies = r.headers["set-cookie"];
    const cookies = Array.isArray(setCookies) ? setCookies : [setCookies ?? ""];
    expect(
      cookies.find((c) => c.startsWith("secure_session=")),
    ).toContain("raw_session_password_reset");
    expect(cookies.find((c) => c.startsWith("csrf_token="))).toContain(
      "raw_csrf_password_reset",
    );

    expect(h.mintCalls).toEqual([
      {
        userId: KNOWN_USER_ID,
        authMethod: "password_reset",
        assuranceLevel: "aal2",
      },
    ]);
    // Password actually applied (not just a session minted).
    expect(h.repoHarness.state.passwordResetsApplied).toEqual([
      { userId: KNOWN_USER_ID, newPassword: "new_strong_password_123" },
    ]);
  });

  it("password-reset/consume failure does NOT mint a session", async () => {
    const h = buildBridgeApp();
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/password-reset/consume",
      headers: goodHeaders,
      payload: {
        token: "definitely-not-a-real-token",
        new_password: "new_strong_password_123",
      },
    });
    expect(r.statusCode).toBe(400);
    expect(h.mintCalls).toHaveLength(0);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("email-verify/consume happy path mints session at aal1", async () => {
    const h = buildBridgeApp();
    const rawToken = mintToken();
    h.repoHarness.state.emailVerificationTokens.set(hashToken(rawToken), {
      userId: KNOWN_USER_ID,
      email: KNOWN_EMAIL,
      expiresAt: new Date(Date.now() + 60_000),
      used: false,
    });

    const r = await h.app.inject({
      method: "POST",
      url: "/auth/email-verify/consume",
      headers: goodHeaders,
      payload: { token: rawToken },
    });

    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      user_id: KNOWN_USER_ID,
      session_id: "sess-email_verify",
      assurance_level: "aal1",
      csrf_token: "raw_csrf_email_verify",
    });
    expect(h.mintCalls).toEqual([
      {
        userId: KNOWN_USER_ID,
        authMethod: "email_verify",
        assuranceLevel: "aal1",
      },
    ]);
  });

  it("email-verify/consume failure does NOT mint a session", async () => {
    const h = buildBridgeApp();
    const r = await h.app.inject({
      method: "POST",
      url: "/auth/email-verify/consume",
      headers: goodHeaders,
      payload: { token: "no-such-token" },
    });
    expect(r.statusCode).toBe(400);
    expect(h.mintCalls).toHaveLength(0);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  // The "loginService is required" guard now lives at the TypeScript
  // type level: `AuthRoutesOptions.loginService: LoginService` (no
  // optional marker). A host that omits it fails to compile, which is
  // a strictly stronger guarantee than the prior runtime warning.
  // There is no behavioral test here because there is no runtime
  // branch left to test — the previous "warn-on-missing" test was
  // superseded by the type contract on 2026-05-09.
});

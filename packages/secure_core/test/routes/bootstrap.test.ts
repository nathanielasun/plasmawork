/**
 * L4.9 — bootstrap route tests.
 *
 * Pure-logic. The `BootstrapService` runs against a fake DB adapter
 * + `FakeWormMarkerProvider`; the route plugin runs against the real
 * `enforceRateLimit` + `enforceCsrfForStateChange` middleware so the
 * "rate limit exhaustion → 429" + "CSRF Origin allowlist" branches
 * exercise live code.
 *
 * Scenario coverage (8 cases per the L4.9 spec):
 *
 *   1. BOOTSTRAP_ALLOWED unset → endpoint not registered (404 before
 *      body validation).
 *   2. WORM marker present at registration → 404.
 *   3. Wrong oob_credential → 403 generic + audit row with
 *      denied_reason: "credential_mismatch".
 *   4. Right credential + first call → 201 + admin user inserted +
 *      WORM marker written + audit row succeeded.
 *   5. Second call after success → 404 (request-time WORM re-check).
 *   6. Rate-limit exhaustion → 429.
 *   7. Body extra field (Ajv additionalProperties: false) → 400.
 *   8. Body missing field → 400.
 *
 * Plus targeted assertions for: audit-row emission on every attempt,
 * the route NEVER reading actor identity from req.body, and the
 * lockout activation after 5 in-window failures.
 */

import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";

import {
  bootstrapRoutes,
  type BootstrapRoutesMiddleware,
} from "../../src/routes/bootstrap.js";
import {
  BootstrapService,
  type BootstrapDbAdapter,
} from "../../src/bootstrap/service.js";
import { FakeWormMarkerProvider } from "../../src/bootstrap/wormMarker.js";
import {
  enforceRateLimit,
  InMemoryRateLimitStore,
  type RateLimitStore,
} from "../../src/middleware/enforceRateLimit.js";
import { enforceCsrfForStateChange } from "../../src/middleware/enforceCsrfForStateChange.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";

// -------------------------------------------------------------------
// Test doubles
// -------------------------------------------------------------------

const ALLOWED_ORIGIN = "https://app.plasmawork.test";
const OOB_CREDENTIAL = "open-sesame-bootstrap-2026";
const OOB_HASH = createHash("sha256")
  .update(OOB_CREDENTIAL, "utf8")
  .digest("hex");

interface AuditCall {
  action: string;
  result: string;
  metadata?: Record<string, unknown>;
  actorType: string;
  actorUserId: string | null;
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
      actorType: string;
      actorUserId: string | null;
      metadata?: Record<string, unknown>;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        metadata: input.metadata,
      });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

interface DbCalls {
  exists: number;
  insertedUsernames: string[];
}

function makeStubDb(opts: {
  initiallyExists?: boolean;
  newId?: string;
}): { db: BootstrapDbAdapter; calls: DbCalls } {
  const calls: DbCalls = { exists: 0, insertedUsernames: [] };
  let exists = opts.initiallyExists ?? false;
  const db: BootstrapDbAdapter = {
    async platformAdminExists() {
      calls.exists += 1;
      return exists;
    },
    async insertPlatformAdmin(args) {
      calls.insertedUsernames.push(args.username);
      exists = true;
      return {
        adminUserId: opts.newId ?? "00000000-0000-4000-8000-000000000001",
      };
    },
  };
  return { db, calls };
}

// -------------------------------------------------------------------
// App factory
// -------------------------------------------------------------------

interface BuildAppOpts {
  bootstrapAllowed: string | undefined;
  initialWormPresent?: boolean;
  initialAdminExists?: boolean;
  rateLimit?: number;
}

function buildApp(opts: BuildAppOpts): {
  app: FastifyInstance;
  audit: ReturnType<typeof makeStubAuditLogger>;
  db: ReturnType<typeof makeStubDb>;
  marker: FakeWormMarkerProvider;
  store: RateLimitStore;
} {
  const audit = makeStubAuditLogger();
  const db = makeStubDb({ initiallyExists: opts.initialAdminExists });
  const marker = new FakeWormMarkerProvider(
    opts.initialWormPresent
      ? {
          admin_user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          completed_at: "2026-01-01T00:00:00.000Z",
          request_id: "seed",
        }
      : undefined,
  );
  const store = new InMemoryRateLimitStore();
  const limit = opts.rateLimit ?? 5;
  const rl = enforceRateLimit({
    limit,
    windowMs: 60_000,
    store,
    auditLogger: audit.logger,
    endpoint: "POST /bootstrap",
  });
  const csrf = enforceCsrfForStateChange({
    auditLogger: audit.logger,
    allowedOrigins: [ALLOWED_ORIGIN],
  });
  const mw: BootstrapRoutesMiddleware = {
    enforceRateLimit: rl,
    enforceCsrfForStateChange: csrf,
  };
  const service = new BootstrapService({
    db: db.db,
    wormMarker: marker,
    auditLogger: audit.logger,
    credentialHashHex: OOB_HASH,
  });

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
  app.register(bootstrapRoutes, {
    service,
    mw,
    auditLogger: audit.logger,
    bootstrapAllowed: opts.bootstrapAllowed,
    wormMarker: marker,
    rateLimitStore: store,
    rateLimitKeyExtractor: (req) => req.ip,
  });

  return { app, audit, db, marker, store };
}

const VALID_BODY = {
  admin_username: "rootadmin42x9k",
  admin_password: "correct-horse-battery-staple-12",
  oob_credential: OOB_CREDENTIAL,
};

const POST_HEADERS = {
  origin: ALLOWED_ORIGIN,
  "content-type": "application/json",
};

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("L4.9 — bootstrap route", () => {
  it("BOOTSTRAP_ALLOWED unset → endpoint not registered (404)", async () => {
    const { app } = buildApp({ bootstrapAllowed: undefined });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: VALID_BODY,
    });
    expect(r.statusCode).toBe(404);
  });

  it("BOOTSTRAP_ALLOWED set to anything other than '1' → 404", async () => {
    const { app } = buildApp({ bootstrapAllowed: "true" });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: VALID_BODY,
    });
    expect(r.statusCode).toBe(404);
  });

  it("WORM marker present at registration → 404 (route not registered)", async () => {
    const { app, audit } = buildApp({
      bootstrapAllowed: "1",
      initialWormPresent: true,
    });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: VALID_BODY,
    });
    expect(r.statusCode).toBe(404);
    // No bootstrap.completed audit row should fire — the route
    // never matched a handler.
    expect(audit.calls.filter((c) => c.action === "bootstrap.completed")).toHaveLength(0);
  });

  it("Wrong oob_credential → 403 generic + audit denied_reason credential_mismatch", async () => {
    const { app, audit, db, marker } = buildApp({ bootstrapAllowed: "1" });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: { ...VALID_BODY, oob_credential: "wrong" },
    });
    expect(r.statusCode).toBe(403);
    const body = r.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("PERMISSION_DENIED");
    // Generic message — no hint about which gate fired.
    expect(body.error.message).toBe("Bootstrap denied.");
    expect(db.calls.insertedUsernames).toHaveLength(0);
    expect(await marker.isBootstrapped()).toBe(false);
    const completed = audit.calls.find(
      (c) => c.action === "bootstrap.completed",
    );
    expect(completed).toBeDefined();
    expect(completed?.result).toBe("denied");
    expect(completed?.metadata?.denied_reason).toBe("credential_mismatch");
    // §19.1 / V4-R3 — pre-auth event.
    expect(completed?.actorType).toBe("unauthenticated");
    expect(completed?.actorUserId).toBeNull();
  });

  it("Right credential + first call → 201 + admin user created + WORM written", async () => {
    const { app, audit, db, marker } = buildApp({ bootstrapAllowed: "1" });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: VALID_BODY,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { admin_user_id: string };
    expect(body.admin_user_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(db.calls.insertedUsernames).toEqual(["rootadmin42x9k"]);
    expect(await marker.isBootstrapped()).toBe(true);
    expect(marker.peek()?.admin_user_id).toBe(body.admin_user_id);
    const completed = audit.calls.find(
      (c) => c.action === "bootstrap.completed" && c.result === "succeeded",
    );
    expect(completed).toBeDefined();
    expect(completed?.metadata?.admin_user_id).toBe(body.admin_user_id);
    expect(completed?.actorType).toBe("unauthenticated");
    expect(completed?.actorUserId).toBeNull();
  });

  it("Second call after success → 404 (request-time WORM re-check via service)", async () => {
    // The plugin registers the route only when the WORM marker is
    // absent at startup. To exercise the request-time re-check we
    // build the app once (route registers), succeed once, then send
    // another request to the SAME app — the service's
    // attemptBootstrap re-queries the marker which is now present
    // and throws BootstrapGateClosedError → 404.
    const { app, audit, db, marker } = buildApp({ bootstrapAllowed: "1" });
    const r1 = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: VALID_BODY,
    });
    expect(r1.statusCode).toBe(201);
    expect(await marker.isBootstrapped()).toBe(true);

    const r2 = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: VALID_BODY,
    });
    expect(r2.statusCode).toBe(404);
    // The DB MUST NOT have a second insert; gate fired before insert.
    expect(db.calls.insertedUsernames).toEqual(["rootadmin42x9k"]);
    // Audit: one succeeded + one denied row.
    const succeeded = audit.calls.filter(
      (c) => c.action === "bootstrap.completed" && c.result === "succeeded",
    );
    const denied = audit.calls.filter(
      (c) => c.action === "bootstrap.completed" && c.result === "denied",
    );
    expect(succeeded).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect(denied[0]?.metadata?.denied_reason).toBe("worm_marker_present");
  });

  it("Rate limit exhaustion → 429 (after 5 attempts in the window)", async () => {
    const { app } = buildApp({ bootstrapAllowed: "1" });
    // Drive five failed attempts with a wrong credential — the
    // limiter is configured to limit=5 in a 60s window. The 6th
    // attempt within the window must return 429 from the limiter.
    for (let i = 0; i < 5; i += 1) {
      const r = await app.inject({
        method: "POST",
        url: "/bootstrap",
        headers: POST_HEADERS,
        payload: { ...VALID_BODY, oob_credential: "wrong" },
      });
      expect(r.statusCode).toBe(403);
    }
    const r6 = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: { ...VALID_BODY, oob_credential: "wrong" },
    });
    expect(r6.statusCode).toBe(429);
    const body = r6.json() as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("Body extra field (additionalProperties: false) → 400", async () => {
    const { app } = buildApp({ bootstrapAllowed: "1" });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: {
        ...VALID_BODY,
        actor_user_id: "evil-injection",
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it("Body missing field → 400", async () => {
    const { app } = buildApp({ bootstrapAllowed: "1" });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: {
        admin_username: "rootadmin42x9k",
        // admin_password missing
        oob_credential: OOB_CREDENTIAL,
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it("Password shorter than 12 chars → 400 (Ajv minLength)", async () => {
    const { app } = buildApp({ bootstrapAllowed: "1" });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: { ...VALID_BODY, admin_password: "short" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("Origin not in allowlist → 403 ORIGIN_MISMATCH (CSRF middleware)", async () => {
    const { app } = buildApp({ bootstrapAllowed: "1" });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      payload: VALID_BODY,
    });
    expect(r.statusCode).toBe(403);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("ORIGIN_MISMATCH");
  });

  it("DB indicates platform admin already exists → 404 + denied_reason admin_exists", async () => {
    // initialWormPresent: false (route registers), but the DB says a
    // platform admin already lives. Service detects at request time.
    const { app, audit } = buildApp({
      bootstrapAllowed: "1",
      initialAdminExists: true,
    });
    const r = await app.inject({
      method: "POST",
      url: "/bootstrap",
      headers: POST_HEADERS,
      payload: VALID_BODY,
    });
    expect(r.statusCode).toBe(404);
    const denied = audit.calls.find(
      (c) => c.action === "bootstrap.completed" && c.result === "denied",
    );
    expect(denied).toBeDefined();
    expect(denied?.metadata?.denied_reason).toBe("admin_exists");
  });
});

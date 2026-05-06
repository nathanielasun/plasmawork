/**
 * `validateInputSchema` middleware — behavior tests.
 *
 * Pins the v4 §4.1 + §3 contract:
 *
 *   1. Each forbidden body field name (`actor`, `actor_user_id`,
 *      `user_id`, `actor_id`, `created_by`, `updated_by`, `approved_by`,
 *      `role_id`, `workspace_id`, `status`, `storage_path`, any
 *      `*_hash`, etc.) — present anywhere in the body — produces 400 +
 *      `UNEXPECTED_FIELD` and emits `request.unexpected_field` BEFORE
 *      the schema runs. Case is ignored (`ACTOR` is rejected too) and
 *      camelCase aliases (`sessionHash`) are rejected too.
 *   2. A body that contains none of the forbidden names passes the
 *      forbidden-scan and is then evaluated against the route schema.
 *   3. Ajv `additionalProperties: false` rejection on an unknown
 *      property surfaces as `UNEXPECTED_FIELD` + audit emission.
 *   4. Type-shape rejection (e.g. `name: 42` when string is required)
 *      surfaces as `INPUT_INVALID` (no audit emission — `INPUT_INVALID`
 *      is shape, not server-derived field smuggling).
 *   5. The happy path passes through to the downstream handler.
 *   6. The audit emission carries `metadata.rejected_field` and the
 *      request id propagated by `requireRequestId`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../../src/server.js";
import {
  validateInputSchema,
  containsForbiddenField,
  FORBIDDEN_BODY_FIELDS,
} from "../../src/middleware/validateInputSchema.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { Sql } from "postgres";

interface CapturedAudit {
  action: string;
  result: string;
  workspaceId: string | null;
  actorUserId: string | null;
  actorType: string;
  metadata: Record<string, unknown> | undefined;
  requestId: string;
}

interface AuditStub {
  logger: AuditLogger;
  rows: CapturedAudit[];
}

function makeAuditStub(): AuditStub {
  const rows: CapturedAudit[] = [];
  const stub = {
    write: async (event: {
      action: string;
      result: string;
      workspaceId: string | null;
      actorUserId: string | null;
      actorType: string;
      metadata?: Record<string, unknown>;
      requestId: string;
    }): Promise<void> => {
      rows.push({
        action: event.action,
        result: event.result,
        workspaceId: event.workspaceId,
        actorUserId: event.actorUserId,
        actorType: event.actorType,
        metadata: event.metadata,
        requestId: event.requestId,
      });
    },
  };
  return { logger: stub as unknown as AuditLogger, rows };
}

const TEST_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    count: { type: "integer" },
  },
} as const;

// `Sql` is decorated onto the app but no middleware under test reads it,
// so a non-functional cast is fine here.
const stubSql = {} as unknown as Sql;

function buildTestApp(audit: AuditStub) {
  const app = buildApp({
    appSql: stubSql,
    errorMapping: {},
    cookieSecret: "test",
  });

  // Test-only handler that registers `validateInputSchema` as a
  // preHandler under a known route. The middleware runs after Fastify's
  // body parsing but before our handler.
  const middleware = validateInputSchema(TEST_BODY_SCHEMA, {
    auditLogger: audit.logger,
  });

  app.route({
    method: "POST",
    url: "/test",
    preHandler: [middleware.handler],
    handler: async (_req, reply) => {
      reply.code(200).send({ ok: true });
    },
  });

  return app;
}

describe("validateInputSchema — forbidden-body scan (v4 §4.1)", () => {
  let audit: AuditStub;

  beforeEach(() => {
    audit = makeAuditStub();
  });

  // Drive every forbidden field through one parametric test so the audit
  // emission fires per name.
  for (const field of FORBIDDEN_BODY_FIELDS) {
    it(`rejects body containing ${field} with UNEXPECTED_FIELD + audit`, async () => {
      const app = buildTestApp(audit);
      const body: Record<string, unknown> = { name: "ok" };
      body[field] = "smuggled";
      const res = await app.inject({
        method: "POST",
        url: "/test",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(body),
      });
      expect(res.statusCode).toBe(400);
      const env = res.json() as {
        error: { code: string; details?: { field?: string } };
      };
      expect(env.error.code).toBe("UNEXPECTED_FIELD");
      expect(env.error.details?.field).toBe(field);

      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0]!.action).toBe("request.unexpected_field");
      expect(audit.rows[0]!.result).toBe("denied");
      expect(audit.rows[0]!.metadata).toEqual({ rejected_field: field });
      await app.close();
    });
  }

  it("rejects forbidden field case-insensitively", async () => {
    const app = buildTestApp(audit);
    const res = await app.inject({
      method: "POST",
      url: "/test",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "ok", ACTOR: "smuggled" }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "UNEXPECTED_FIELD",
    );
    expect(audit.rows[0]!.metadata).toEqual({ rejected_field: "ACTOR" });
    await app.close();
  });

  it("rejects forbidden fields recursively before Ajv schema validation", async () => {
    const app = buildTestApp(audit);
    const res = await app.inject({
      method: "POST",
      url: "/test",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        name: "ok",
        metadata: {
          nested: {
            role_id: "smuggled-role",
          },
        },
      }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "UNEXPECTED_FIELD",
    );
    expect(audit.rows[0]!.metadata).toEqual({
      rejected_field: "metadata.nested.role_id",
    });
    await app.close();
  });

  it("rejects forbidden fields inside array bodies", () => {
    expect(containsForbiddenField([{ ok: true }, { session_hash: "x" }])).toBe(
      "[1].session_hash",
    );
  });

  it("rejects camelCase aliases and wildcard *_hash fields", () => {
    expect(containsForbiddenField({ sessionHash: "x" })).toBe("sessionHash");
    expect(containsForbiddenField({ lock_token_hash: "x" })).toBe(
      "lock_token_hash",
    );
    expect(containsForbiddenField({ nested: { tokenContextHash: "x" } })).toBe(
      "nested.tokenContextHash",
    );
  });
});

describe("validateInputSchema — Ajv schema gate", () => {
  let audit: AuditStub;

  beforeEach(() => {
    audit = makeAuditStub();
  });

  it("passes the happy path through to the downstream handler", async () => {
    const app = buildTestApp(audit);
    const res = await app.inject({
      method: "POST",
      url: "/test",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "alpha", count: 7 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(audit.rows.length).toBe(0);
    await app.close();
  });

  it("rejects an extra property under additionalProperties:false as UNEXPECTED_FIELD + audit", async () => {
    const app = buildTestApp(audit);
    const res = await app.inject({
      method: "POST",
      url: "/test",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "alpha", undeclared: true }),
    });
    expect(res.statusCode).toBe(400);
    const env = res.json() as {
      error: { code: string; details?: { field?: string } };
    };
    expect(env.error.code).toBe("UNEXPECTED_FIELD");
    expect(env.error.details?.field).toBe("undeclared");

    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]!.action).toBe("request.unexpected_field");
    expect(audit.rows[0]!.metadata).toEqual({ rejected_field: "undeclared" });
    await app.close();
  });

  it("rejects malformed type as INPUT_INVALID (no audit emission)", async () => {
    const app = buildTestApp(audit);
    const res = await app.inject({
      method: "POST",
      url: "/test",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: 42 }),
    });
    expect(res.statusCode).toBe(400);
    const env = res.json() as { error: { code: string } };
    expect(env.error.code).toBe("INPUT_INVALID");
    expect(audit.rows.length).toBe(0);
    await app.close();
  });

  it("rejects missing required field as INPUT_INVALID", async () => {
    const app = buildTestApp(audit);
    const res = await app.inject({
      method: "POST",
      url: "/test",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ count: 1 }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "INPUT_INVALID",
    );
    await app.close();
  });
});

describe("validateInputSchema — helpers", () => {
  it("containsForbiddenField returns null for non-objects and clean bodies", () => {
    expect(containsForbiddenField(null)).toBeNull();
    expect(containsForbiddenField(undefined)).toBeNull();
    expect(containsForbiddenField("a string")).toBeNull();
    expect(containsForbiddenField([1, 2])).toBeNull();
    expect(containsForbiddenField({ name: "ok" })).toBeNull();
  });

  it("containsForbiddenField returns the offending key (case preserved)", () => {
    expect(containsForbiddenField({ Actor: "x" })).toBe("Actor");
    expect(containsForbiddenField({ name: "ok", user_id: "x" })).toBe(
      "user_id",
    );
  });

  it("FORBIDDEN_BODY_FIELDS covers every v4 §4.1 named field", () => {
    expect([...FORBIDDEN_BODY_FIELDS].sort()).toEqual(
      [
        "actor",
        "actor_id",
        "actor_user_id",
        "approved_by",
        "assurance_level",
        "auth_method",
        "created_at",
        "created_by",
        "current_version_id",
        "decided_by",
        "disabled_at",
        "id",
        "prev_hash",
        "role_id",
        "row_hash",
        "session_hash",
        "status",
        "storage_path",
        "token_hash",
        "updated_at",
        "updated_by",
        "user_id",
        "workspace_id",
        "workspace_role",
      ].sort(),
    );
  });
});

/**
 * L4.7 — audit-events + provenance-events route tests.
 *
 * Pure-logic. Stubbed `AuditReadService` + passthrough middleware
 * bundle (every middleware pre-populates the request fields the
 * handler reads). DB-bound behavior is pinned by the service's
 * own DB-gated tests in `test/audit/readService.test.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

import {
  auditEventsRoutes,
  type AuditEventsRoutesMiddleware,
} from "../../src/routes/auditEvents.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import { SecureCoreError } from "../../src/errors/shapes.js";
import type {
  AuditContext,
  AuthContext,
  MembershipContext,
  WorkspaceContext,
} from "../../src/middleware/types.js";
import type {
  AuditEventOutputRow,
  AuditReadService,
  KeysetCursor,
  ListAuditEventsOptions,
  ListAuditEventsResult,
  ListProvenanceEventsResult,
  ProvenanceEventOutputRow,
} from "../../src/audit/readService.js";

const VALID_WS_A = "11111111-1111-4111-8111-111111111111";
const VALID_WS_B = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

// -------------------------------------------------------------------
// Stubs
// -------------------------------------------------------------------

interface ServiceCalls {
  listAuditEvents: Array<{
    workspaceId: string;
    opts: ListAuditEventsOptions;
  }>;
  listProvenanceEvents: Array<{
    workspaceId: string;
    opts: ListAuditEventsOptions;
  }>;
}

interface StubServiceConfig {
  /** Map workspaceId -> rows for audit_events. */
  auditByWorkspace?: Record<string, AuditEventOutputRow[]>;
  /** Map workspaceId -> rows for provenance_events. */
  provenanceByWorkspace?: Record<string, ProvenanceEventOutputRow[]>;
}

function makeStubService(cfg: StubServiceConfig = {}): {
  service: AuditReadService;
  calls: ServiceCalls;
} {
  const calls: ServiceCalls = {
    listAuditEvents: [],
    listProvenanceEvents: [],
  };

  const paginate = <T extends { id: string; created_at: string }>(
    rows: T[],
    opts: ListAuditEventsOptions,
  ): { rows: T[]; nextCursor: KeysetCursor | null } => {
    let working = rows;
    if (opts.cursor !== undefined) {
      const cursorMs = opts.cursor.createdAt.getTime();
      const cursorId = opts.cursor.id;
      working = working.filter((r) => {
        const rowMs = new Date(r.created_at).getTime();
        if (rowMs < cursorMs) return true;
        if (rowMs > cursorMs) return false;
        return r.id < cursorId;
      });
    }
    const fetchLimit = opts.limit + 1;
    const slice = working.slice(0, fetchLimit);
    const hasMore = slice.length > opts.limit;
    const surviving = hasMore ? slice.slice(0, opts.limit) : slice;
    const nextCursor =
      hasMore && surviving.length > 0
        ? {
            createdAt: new Date(surviving[surviving.length - 1].created_at),
            id: surviving[surviving.length - 1].id,
          }
        : null;
    return { rows: surviving, nextCursor };
  };

  const service = {
    async listAuditEvents(
      workspaceId: string,
      opts: ListAuditEventsOptions,
    ): Promise<ListAuditEventsResult> {
      calls.listAuditEvents.push({ workspaceId, opts });
      const rows = cfg.auditByWorkspace?.[workspaceId] ?? [];
      return paginate(rows, opts);
    },
    async listProvenanceEvents(
      workspaceId: string,
      opts: ListAuditEventsOptions,
    ): Promise<ListProvenanceEventsResult> {
      calls.listProvenanceEvents.push({ workspaceId, opts });
      const rows = cfg.provenanceByWorkspace?.[workspaceId] ?? [];
      return paginate(rows, opts);
    },
  } as unknown as AuditReadService;

  return { service, calls };
}

const baseAuth: AuthContext = {
  userId: ACTOR,
  sessionId: "sess-1",
  actorType: "human",
  assuranceLevel: "aal2",
};
const baseAudit: AuditContext = {
  actorUserId: ACTOR,
  actorType: "human",
  requestId: "req-test",
};
const baseWorkspace: WorkspaceContext = {
  id: VALID_WS_A,
  name: "ws-A",
  createdBy: ACTOR,
};
const baseMembership: MembershipContext = {
  workspaceId: VALID_WS_A,
  userId: ACTOR,
  roleId: "role-reviewer",
  roleName: "Reviewer",
  capabilities: new Set(["audit:read" as const]),
};

interface BundleOptions {
  authed?: boolean;
  auditReadAllowed?: boolean;
}

type WrapName =
  | "requireAuth"
  | "attachAuditActor"
  | "loadWorkspace"
  | "enforceUniformNotFound"
  | "requireWorkspaceMembership"
  | "requireCapability";

function makeMiddlewareBundle(opts: BundleOptions): AuditEventsRoutesMiddleware {
  const wrap = (
    name: WrapName,
    role: WrapName | "requireAuditRead",
  ): AuditEventsRoutesMiddleware[keyof AuditEventsRoutesMiddleware] => ({
    name,
    handler: async (req) => {
      if (role === "requireAuth") {
        if (opts.authed === false) {
          throw new SecureCoreError("UNAUTHENTICATED", "no auth.");
        }
        req.auth = baseAuth;
      }
      if (role === "attachAuditActor") req.audit = baseAudit;
      if (role === "loadWorkspace") req.workspace = baseWorkspace;
      if (role === "requireWorkspaceMembership") req.membership = baseMembership;
      if (role === "requireAuditRead" && opts.auditReadAllowed === false) {
        throw new SecureCoreError("PERMISSION_DENIED", "no audit:read.");
      }
    },
  });

  return {
    requireAuth: wrap("requireAuth", "requireAuth"),
    attachAuditActor: wrap("attachAuditActor", "attachAuditActor"),
    loadWorkspace: wrap("loadWorkspace", "loadWorkspace"),
    enforceUniformNotFound: wrap("enforceUniformNotFound", "enforceUniformNotFound"),
    requireWorkspaceMembership: wrap(
      "requireWorkspaceMembership",
      "requireWorkspaceMembership",
    ),
    requireAuditRead: wrap("requireCapability", "requireAuditRead"),
  };
}

function buildApp(
  service: AuditReadService,
  mw: AuditEventsRoutesMiddleware,
): FastifyInstance {
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
  app.register(auditEventsRoutes, { service, mw });
  return app;
}

// -------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------

/**
 * Build a deterministic UUID v4 from a 12-hex-char suffix. The suffix
 * must be hex; UUID parsing is strict, and the route refuses non-hex
 * cursor ids with INPUT_INVALID.
 */
function auditRow(hexSuffix: string, isoCreatedAt: string): AuditEventOutputRow {
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${hexSuffix}`,
    actor_user_id: ACTOR,
    actor_type: "human",
    action: "capsule.created",
    object_type: "capsule",
    object_id: null,
    result: "ok",
    request_id: "req-prior",
    created_at: isoCreatedAt,
    metadata: {},
  };
}

function provenanceRow(
  hexSuffix: string,
  isoCreatedAt: string,
): ProvenanceEventOutputRow {
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${hexSuffix}`,
    actor_user_id: ACTOR,
    actor_type: "human",
    capsule_id: null,
    run_id: null,
    action: "capsule.updated",
    object_type: "capsule",
    object_id: null,
    created_at: isoCreatedAt,
    metadata: {},
  };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("L4.7 — audit-events + provenance-events read routes", () => {
  let stub: ReturnType<typeof makeStubService>;

  beforeEach(() => {
    stub = makeStubService({
      auditByWorkspace: {
        [VALID_WS_A]: [
          auditRow("aaaaaaaaaaa1", "2025-01-05T00:00:00.000Z"),
          auditRow("aaaaaaaaaaa2", "2025-01-04T00:00:00.000Z"),
          auditRow("aaaaaaaaaaa3", "2025-01-03T00:00:00.000Z"),
          auditRow("aaaaaaaaaaa4", "2025-01-02T00:00:00.000Z"),
          auditRow("aaaaaaaaaaa5", "2025-01-01T00:00:00.000Z"),
        ],
        [VALID_WS_B]: [auditRow("bbbbbbbbbbb1", "2025-01-10T00:00:00.000Z")],
      },
      provenanceByWorkspace: {
        [VALID_WS_A]: [
          provenanceRow("cccccccccc01", "2025-02-05T00:00:00.000Z"),
          provenanceRow("cccccccccc02", "2025-02-04T00:00:00.000Z"),
          provenanceRow("cccccccccc03", "2025-02-03T00:00:00.000Z"),
        ],
        [VALID_WS_B]: [
          provenanceRow("dddddddddd01", "2025-02-10T00:00:00.000Z"),
        ],
      },
    });
  });

  // -------- audit-events --------

  it("GET /audit-events returns the list", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/audit-events`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { events: AuditEventOutputRow[]; next_cursor?: string };
    expect(body.events).toHaveLength(5);
    expect(body.next_cursor).toBeUndefined();
    expect(stub.calls.listAuditEvents).toHaveLength(1);
    expect(stub.calls.listAuditEvents[0].workspaceId).toBe(VALID_WS_A);
    expect(stub.calls.listAuditEvents[0].opts.limit).toBe(50);
  });

  it("GET /audit-events with limit=2 returns 2 rows + next_cursor", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/audit-events?limit=2`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { events: AuditEventOutputRow[]; next_cursor?: string };
    expect(body.events).toHaveLength(2);
    expect(body.next_cursor).toBeTypeOf("string");
  });

  it("GET /audit-events with limit > MAX_LIMIT (200) is rejected by Ajv", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/audit-events?limit=999`,
    });
    expect(r.statusCode).toBe(400);
  });

  it("GET /audit-events with cursor advances past first page", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r1 = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/audit-events?limit=2`,
    });
    const body1 = r1.json() as { events: AuditEventOutputRow[]; next_cursor?: string };
    expect(body1.next_cursor).toBeTypeOf("string");
    const cursor = body1.next_cursor as string;

    const r2 = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/audit-events?limit=2&cursor=${encodeURIComponent(cursor)}`,
    });
    expect(r2.statusCode).toBe(200);
    const body2 = r2.json() as { events: AuditEventOutputRow[]; next_cursor?: string };
    expect(body2.events).toHaveLength(2);
    // No overlap between page 1 and page 2.
    const seen = new Set(body1.events.map((e) => e.id));
    for (const e of body2.events) {
      expect(seen.has(e.id)).toBe(false);
    }
    // Page 2's rows are strictly older than page 1's last row.
    const lastP1 = body1.events[body1.events.length - 1];
    for (const e of body2.events) {
      expect(new Date(e.created_at).getTime()).toBeLessThanOrEqual(
        new Date(lastP1.created_at).getTime(),
      );
    }
  });

  it("GET /audit-events 403 without audit:read capability", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ auditReadAllowed: false }),
    );
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/audit-events`,
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.listAuditEvents).toHaveLength(0);
  });

  it("GET /audit-events 404 for non-UUID workspaceId", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/not-a-uuid/audit-events`,
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET /audit-events with malformed cursor → 400 INPUT_INVALID", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/audit-events?cursor=not%2Da%2Dvalid%2Dcursor`,
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("INPUT_INVALID");
  });

  it("GET /audit-events isolates workspace A from workspace B", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/audit-events`,
    });
    expect(r.statusCode).toBe(200);
    expect(stub.calls.listAuditEvents).toHaveLength(1);
    // Service was called with workspace A's id, NOT B's. Returned rows
    // must not include the workspace-B-only row.
    expect(stub.calls.listAuditEvents[0].workspaceId).toBe(VALID_WS_A);
    const body = r.json() as { events: AuditEventOutputRow[] };
    for (const e of body.events) {
      expect(e.id.startsWith("bbbbbbbb")).toBe(false);
    }
  });

  it("GET /audit-events rejects unknown query keys", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/audit-events?actor=evil`,
    });
    expect(r.statusCode).toBe(400);
  });

  // -------- provenance-events --------

  it("GET /provenance-events returns the list", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/provenance-events`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      events: ProvenanceEventOutputRow[];
      next_cursor?: string;
    };
    expect(body.events).toHaveLength(3);
    expect(body.next_cursor).toBeUndefined();
    expect(stub.calls.listProvenanceEvents).toHaveLength(1);
  });

  it("GET /provenance-events with limit=300 rejected (max 200)", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/provenance-events?limit=300`,
    });
    expect(r.statusCode).toBe(400);
  });

  it("GET /provenance-events with cursor advances past first page", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r1 = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/provenance-events?limit=1`,
    });
    const body1 = r1.json() as {
      events: ProvenanceEventOutputRow[];
      next_cursor?: string;
    };
    expect(body1.events).toHaveLength(1);
    expect(body1.next_cursor).toBeTypeOf("string");

    const r2 = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/provenance-events?limit=1&cursor=${encodeURIComponent(body1.next_cursor as string)}`,
    });
    expect(r2.statusCode).toBe(200);
    const body2 = r2.json() as {
      events: ProvenanceEventOutputRow[];
    };
    expect(body2.events).toHaveLength(1);
    expect(body2.events[0].id).not.toBe(body1.events[0].id);
  });

  it("GET /provenance-events 403 without audit:read", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ auditReadAllowed: false }),
    );
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/provenance-events`,
    });
    expect(r.statusCode).toBe(403);
    expect(stub.calls.listProvenanceEvents).toHaveLength(0);
  });

  it("GET /provenance-events 404 for non-UUID workspaceId", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/not-a-uuid/provenance-events`,
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET /provenance-events with malformed cursor → 400 INPUT_INVALID", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/provenance-events?cursor=%7B%22bogus%22%3Atrue%7D`,
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("INPUT_INVALID");
  });

  it("GET /provenance-events isolates workspace A from workspace B", async () => {
    const app = buildApp(stub.service, makeMiddlewareBundle({}));
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/provenance-events`,
    });
    expect(r.statusCode).toBe(200);
    expect(stub.calls.listProvenanceEvents[0].workspaceId).toBe(VALID_WS_A);
    const body = r.json() as { events: ProvenanceEventOutputRow[] };
    for (const e of body.events) {
      expect(e.id.includes("dddddddddd01")).toBe(false);
    }
  });

  it("GET /provenance-events refuses without auth (401)", async () => {
    const app = buildApp(
      stub.service,
      makeMiddlewareBundle({ authed: false }),
    );
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS_A}/provenance-events`,
    });
    expect(r.statusCode).toBe(401);
  });
});

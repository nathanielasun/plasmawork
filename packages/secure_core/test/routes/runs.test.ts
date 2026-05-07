/**
 * L4.3 — run route tests.
 *
 * Pure-logic. Stubbed `RunStateMachine` + `RunQueryService` +
 * passthrough mw bundle. DB-bound transition semantics are pinned by
 * the L3.6 state machine's own DB-gated tests in
 * `test/runs/stateMachine.test.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

import {
  runRoutes,
  type RunRoutesMiddleware,
} from "../../src/routes/runs.js";
import { requireRequestId } from "../../src/middleware/requireRequestId.js";
import { toHttpResponse } from "../../src/errors/mapper.js";
import {
  SecureCoreError,
  NotFoundError,
} from "../../src/errors/shapes.js";
import type {
  AuditContext,
  AuthContext,
  MembershipContext,
  WorkspaceContext,
} from "../../src/middleware/types.js";
import type {
  CreateRunOptions,
  RunRow,
  RunStateMachine,
  TransitionOptions,
} from "../../src/runs/stateMachine.js";
import type {
  CapsuleForRunCreate,
  ListRunsOptions,
  ListRunsResult,
  RunQueryService,
} from "../../src/runs/queryService.js";

const VALID_WS = "11111111-1111-4111-8111-111111111111";
const VALID_CAP = "22222222-2222-4222-8222-222222222222";
const VERSION_A = "33333333-3333-4333-8333-333333333333";
const BODY_VERSION = "44444444-4444-4444-8444-444444444444";
const RUN_A = "55555555-5555-4555-8555-555555555555";
const RUN_B = "66666666-6666-4666-8666-666666666666";
const RUN_C = "77777777-7777-4777-8777-777777777777";
const ACTOR = "88888888-8888-4888-8888-888888888888";

// -------------------------------------------------------------------
// Stub builders
// -------------------------------------------------------------------

interface StateMachineCalls {
  createRun: CreateRunOptions[];
  transition: TransitionOptions[];
}

interface StateMachineConfig {
  /** If set, every transition() call throws this. */
  transitionError?: Error;
  /** If set, every createRun() call throws this. */
  createError?: Error;
}

function makeRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN_A,
    workspace_id: VALID_WS,
    capsule_id: VALID_CAP,
    capsule_version_id: VERSION_A,
    status: "created",
    backend: "local",
    requested_by: ACTOR,
    approved_by: null,
    cancellation_reason: null,
    failure_message: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    started_at: null,
    finished_at: null,
    canceled_at: null,
    ...overrides,
  };
}

function makeStubStateMachine(cfg: StateMachineConfig = {}): {
  stateMachine: RunStateMachine;
  calls: StateMachineCalls;
} {
  const calls: StateMachineCalls = { createRun: [], transition: [] };
  const stateMachine = {
    async createRun(opts: CreateRunOptions): Promise<RunRow> {
      calls.createRun.push(opts);
      if (cfg.createError !== undefined) throw cfg.createError;
      return makeRow({
        id: RUN_A,
        workspace_id: opts.workspaceId,
        capsule_id: opts.capsuleId,
        capsule_version_id: opts.capsuleVersionId,
        backend: opts.backend,
        requested_by: opts.requestedBy,
        status: "created",
      });
    },
    async transition(opts: TransitionOptions): Promise<RunRow> {
      calls.transition.push(opts);
      if (cfg.transitionError !== undefined) throw cfg.transitionError;
      return makeRow({
        id: opts.runId,
        workspace_id: opts.workspaceId,
        status: opts.toState,
        cancellation_reason: opts.cancellationReason ?? null,
      });
    },
    async recordEvent(): Promise<void> {
      /* not used by the route surface */
    },
    async listEvents(): Promise<[]> {
      return [];
    },
  } as unknown as RunStateMachine;
  return { stateMachine, calls };
}

interface QueryCalls {
  listRuns: Array<{ workspaceId: string; opts: ListRunsOptions }>;
  getRunOrThrow: Array<{ workspaceId: string; runId: string }>;
  getRunStateForCancel: Array<{ workspaceId: string; runId: string }>;
  getCapsuleForRunCreate: Array<{
    workspaceId: string;
    capsuleId: string;
    expectedVersionId?: string;
  }>;
}

interface QueryConfig {
  /** Rows ordered by (created_at DESC, id DESC). */
  rows?: RunRow[];
  /** Map runId -> current status. Default: "running" for any runId. */
  cancelStateByRunId?: Record<string, string>;
  /** If runId is in this set, getRunStateForCancel throws NotFoundError. */
  cancelMissingRunIds?: Set<string>;
  /** If true, getCapsuleForRunCreate throws NotFoundError. */
  capsuleMissing?: boolean;
}

function makeStubQueryService(cfg: QueryConfig = {}): {
  queryService: RunQueryService;
  calls: QueryCalls;
} {
  const calls: QueryCalls = {
    listRuns: [],
    getRunOrThrow: [],
    getRunStateForCancel: [],
    getCapsuleForRunCreate: [],
  };
  const allRows = cfg.rows ?? [];
  const queryService = {
    async listRuns(
      workspaceId: string,
      opts: ListRunsOptions,
    ): Promise<ListRunsResult> {
      calls.listRuns.push({ workspaceId, opts });
      let working = allRows.filter((r) => r.workspace_id === workspaceId);
      if (opts.status !== undefined) {
        working = working.filter((r) => r.status === opts.status);
      }
      if (opts.capsuleId !== undefined) {
        working = working.filter((r) => r.capsule_id === opts.capsuleId);
      }
      if (opts.cursor !== undefined) {
        const cMs = opts.cursor.createdAt.getTime();
        const cId = opts.cursor.id;
        working = working.filter((r) => {
          const rMs = r.created_at.getTime();
          if (rMs < cMs) return true;
          if (rMs > cMs) return false;
          return r.id < cId;
        });
      }
      const fetchLimit = opts.limit + 1;
      const slice = working.slice(0, fetchLimit);
      const hasMore = slice.length > opts.limit;
      const surviving = hasMore ? slice.slice(0, opts.limit) : slice;
      const nextCursor =
        hasMore && surviving.length > 0
          ? {
              createdAt: surviving[surviving.length - 1].created_at,
              id: surviving[surviving.length - 1].id,
            }
          : null;
      return { rows: surviving, nextCursor };
    },
    async getRunOrThrow(workspaceId: string, runId: string): Promise<RunRow> {
      calls.getRunOrThrow.push({ workspaceId, runId });
      const row = allRows.find(
        (r) => r.id === runId && r.workspace_id === workspaceId,
      );
      if (row === undefined) {
        throw new NotFoundError("Run not found.", { run_id: runId });
      }
      return row;
    },
    async getRunStateForCancel(
      workspaceId: string,
      runId: string,
    ): Promise<string> {
      calls.getRunStateForCancel.push({ workspaceId, runId });
      if (cfg.cancelMissingRunIds?.has(runId) === true) {
        throw new NotFoundError("Run not found.", { run_id: runId });
      }
      return cfg.cancelStateByRunId?.[runId] ?? "running";
    },
    async getCapsuleForRunCreate(opts: {
      workspaceId: string;
      capsuleId: string;
      expectedVersionId?: string;
    }): Promise<CapsuleForRunCreate> {
      calls.getCapsuleForRunCreate.push(opts);
      if (cfg.capsuleMissing === true) {
        throw new NotFoundError("Capsule not found.", {
          capsule_id: opts.capsuleId,
        });
      }
      return {
        capsuleId: opts.capsuleId,
        resolvedVersionId: opts.expectedVersionId ?? VERSION_A,
      };
    },
  } as unknown as RunQueryService;
  return { queryService, calls };
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
  id: VALID_WS,
  name: "ws-1",
  createdBy: ACTOR,
};
const baseMembership: MembershipContext = {
  workspaceId: VALID_WS,
  userId: ACTOR,
  roleId: "role-runner",
  roleName: "Runner",
  capabilities: new Set(["run:create" as const, "run:cancel" as const]),
};

interface BundleOptions {
  authed?: boolean;
  runCreateAllowed?: boolean;
  runCancelAllowed?: boolean;
}

type Role =
  | "requireAuth"
  | "enforceCsrfForStateChange"
  | "attachAuditActor"
  | "loadWorkspace"
  | "enforceUniformNotFound"
  | "requireWorkspaceMembership"
  | "requireRunCreate"
  | "requireRunCancel";

function makeMiddlewareBundle(opts: BundleOptions): RunRoutesMiddleware {
  const wrap = (
    role: Role,
  ): RunRoutesMiddleware[keyof RunRoutesMiddleware] => ({
    name:
      role === "requireRunCreate" || role === "requireRunCancel"
        ? "requireCapability"
        : role,
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
      if (role === "requireRunCreate" && opts.runCreateAllowed === false) {
        throw new SecureCoreError("PERMISSION_DENIED", "no run:create.");
      }
      if (role === "requireRunCancel" && opts.runCancelAllowed === false) {
        throw new SecureCoreError("PERMISSION_DENIED", "no run:cancel.");
      }
    },
  });

  return {
    requireAuth: wrap("requireAuth"),
    enforceCsrfForStateChange: wrap("enforceCsrfForStateChange"),
    attachAuditActor: wrap("attachAuditActor"),
    loadWorkspace: wrap("loadWorkspace"),
    enforceUniformNotFound: wrap("enforceUniformNotFound"),
    requireWorkspaceMembership: wrap("requireWorkspaceMembership"),
    requireRunCreate: wrap("requireRunCreate"),
    requireRunCancel: wrap("requireRunCancel"),
  };
}

function buildApp(
  stateMachine: RunStateMachine,
  queryService: RunQueryService,
  mw: RunRoutesMiddleware,
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
  app.register(runRoutes, { stateMachine, queryService, mw });
  return app;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("L4.3 — run routes", () => {
  let smStub: ReturnType<typeof makeStubStateMachine>;

  beforeEach(() => {
    smStub = makeStubStateMachine();
  });

  // -------- POST create --------

  it("POST /capsules/:id/runs creates with default version", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}/runs`,
      payload: { backend: "local" },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { run: { capsule_version_id: string } };
    expect(body.run.capsule_version_id).toBe(VERSION_A);
    expect(qStub.calls.getCapsuleForRunCreate[0]).toMatchObject({
      workspaceId: VALID_WS,
      capsuleId: VALID_CAP,
      expectedVersionId: undefined,
    });
    expect(smStub.calls.createRun[0]).toMatchObject({
      workspaceId: VALID_WS,
      capsuleId: VALID_CAP,
      capsuleVersionId: VERSION_A,
      backend: "local",
      requestedBy: ACTOR,
    });
  });

  it("POST /capsules/:id/runs honors body capsule_version_id", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}/runs`,
      payload: { backend: "local", capsule_version_id: BODY_VERSION },
    });
    expect(r.statusCode).toBe(201);
    expect(qStub.calls.getCapsuleForRunCreate[0]?.expectedVersionId).toBe(
      BODY_VERSION,
    );
    expect(smStub.calls.createRun[0]?.capsuleVersionId).toBe(BODY_VERSION);
  });

  it("POST /capsules/:id/runs rejects extra body fields (additionalProperties)", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}/runs`,
      payload: { backend: "local", actor_user_id: "evil" },
    });
    expect(r.statusCode).toBe(400);
    expect(qStub.calls.getCapsuleForRunCreate).toHaveLength(0);
    expect(smStub.calls.createRun).toHaveLength(0);
  });

  it("POST /capsules/:id/runs rejects missing backend", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}/runs`,
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it("POST /capsules/:id/runs returns 404 when capsule unknown", async () => {
    const qStub = makeStubQueryService({ capsuleMissing: true });
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}/runs`,
      payload: { backend: "local" },
    });
    expect(r.statusCode).toBe(404);
    expect(smStub.calls.createRun).toHaveLength(0);
  });

  it("POST /capsules/:id/runs returns 403 without run:create capability", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({ runCreateAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/capsules/${VALID_CAP}/runs`,
      payload: { backend: "local" },
    });
    expect(r.statusCode).toBe(403);
    expect(qStub.calls.getCapsuleForRunCreate).toHaveLength(0);
    expect(smStub.calls.createRun).toHaveLength(0);
  });

  // -------- GET list --------

  it("GET /runs lists with status filter", async () => {
    const rows: RunRow[] = [
      makeRow({
        id: RUN_A,
        status: "running",
        created_at: new Date("2026-01-03T00:00:00.000Z"),
      }),
      makeRow({
        id: RUN_B,
        status: "completed",
        created_at: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ];
    const qStub = makeStubQueryService({ rows });
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/runs?status=running`,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { runs: Array<{ id: string }> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe(RUN_A);
    expect(qStub.calls.listRuns[0].opts.status).toBe("running");
  });

  it("GET /runs rejects unknown status with 400", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/runs?status=zombie`,
    });
    expect(r.statusCode).toBe(400);
    expect(qStub.calls.listRuns).toHaveLength(0);
  });

  it("GET /runs cursor advances past first page", async () => {
    const rows: RunRow[] = [
      makeRow({ id: RUN_A, created_at: new Date("2026-01-03T00:00:00.000Z") }),
      makeRow({ id: RUN_B, created_at: new Date("2026-01-02T00:00:00.000Z") }),
      makeRow({ id: RUN_C, created_at: new Date("2026-01-01T00:00:00.000Z") }),
    ];
    const qStub = makeStubQueryService({ rows });
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r1 = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/runs?limit=2`,
    });
    expect(r1.statusCode).toBe(200);
    const body1 = r1.json() as {
      runs: Array<{ id: string }>;
      next_cursor?: string;
    };
    expect(body1.runs).toHaveLength(2);
    expect(body1.next_cursor).toBeTypeOf("string");

    const r2 = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/runs?limit=2&cursor=${encodeURIComponent(
        body1.next_cursor as string,
      )}`,
    });
    expect(r2.statusCode).toBe(200);
    const body2 = r2.json() as { runs: Array<{ id: string }> };
    expect(body2.runs).toHaveLength(1);
    expect(body2.runs[0].id).toBe(RUN_C);
    const seen = new Set(body1.runs.map((r) => r.id));
    expect(seen.has(body2.runs[0].id)).toBe(false);
  });

  // -------- GET read one --------

  it("GET /runs/:runId refuses non-UUID with 404", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/runs/not-a-uuid`,
    });
    expect(r.statusCode).toBe(404);
    expect(qStub.calls.getRunOrThrow).toHaveLength(0);
  });

  it("GET /runs/:runId returns 404 when service throws NotFoundError", async () => {
    const qStub = makeStubQueryService(); // empty rows -> throws
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "GET",
      url: `/workspaces/${VALID_WS}/runs/${RUN_A}`,
    });
    expect(r.statusCode).toBe(404);
    expect(qStub.calls.getRunOrThrow[0]).toMatchObject({
      workspaceId: VALID_WS,
      runId: RUN_A,
    });
  });

  // -------- POST cancel --------

  it("POST /runs/:runId/cancel happy path emits cancel_requested transition", async () => {
    const qStub = makeStubQueryService({
      cancelStateByRunId: { [RUN_A]: "running" },
    });
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/runs/${RUN_A}/cancel`,
      payload: { reason: "user requested abort" },
    });
    expect(r.statusCode).toBe(200);
    expect(smStub.calls.transition[0]).toMatchObject({
      runId: RUN_A,
      workspaceId: VALID_WS,
      expectedFromState: "running",
      toState: "cancel_requested",
      cancellationReason: "user requested abort",
      actorUserId: ACTOR,
      actorType: "human",
    });
  });

  it("POST /runs/:runId/cancel returns 409 when run is terminal", async () => {
    const qStub = makeStubQueryService({
      cancelStateByRunId: { [RUN_A]: "completed" },
    });
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/runs/${RUN_A}/cancel`,
      payload: { reason: "too late" },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(smStub.calls.transition).toHaveLength(0);
  });

  it("POST /runs/:runId/cancel returns 409 when already cancel_requested", async () => {
    const qStub = makeStubQueryService({
      cancelStateByRunId: { [RUN_A]: "cancel_requested" },
    });
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/runs/${RUN_A}/cancel`,
      payload: { reason: "double-tap" },
    });
    expect(r.statusCode).toBe(409);
    expect(smStub.calls.transition).toHaveLength(0);
  });

  it("POST /runs/:runId/cancel rejects empty reason with 400", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/runs/${RUN_A}/cancel`,
      payload: { reason: "" },
    });
    expect(r.statusCode).toBe(400);
    expect(qStub.calls.getRunStateForCancel).toHaveLength(0);
    expect(smStub.calls.transition).toHaveLength(0);
  });

  it("POST /runs/:runId/cancel rejects missing reason with 400", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/runs/${RUN_A}/cancel`,
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it("POST /runs/:runId/cancel returns 403 without run:cancel capability", async () => {
    const qStub = makeStubQueryService();
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({ runCancelAllowed: false }),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/runs/${RUN_A}/cancel`,
      payload: { reason: "abort" },
    });
    expect(r.statusCode).toBe(403);
    expect(qStub.calls.getRunStateForCancel).toHaveLength(0);
    expect(smStub.calls.transition).toHaveLength(0);
  });

  it("POST /runs/:runId/cancel returns 404 when run unknown", async () => {
    const qStub = makeStubQueryService({
      cancelMissingRunIds: new Set([RUN_A]),
    });
    const app = buildApp(
      smStub.stateMachine,
      qStub.queryService,
      makeMiddlewareBundle({}),
    );
    const r = await app.inject({
      method: "POST",
      url: `/workspaces/${VALID_WS}/runs/${RUN_A}/cancel`,
      payload: { reason: "abort" },
    });
    expect(r.statusCode).toBe(404);
    expect(smStub.calls.transition).toHaveLength(0);
  });
});

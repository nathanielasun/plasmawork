/**
 * L3.6 — RunStateMachine behavior tests.
 *
 * Pins:
 *   1. The static transition table matches v4 §14 exactly (snapshot
 *      equality).
 *   2. `RUN_TERMINAL_STATES` is the v4 §14 set of four.
 *   3. `isLegalTransition` answers correctly for boundary pairs.
 *   4. `createRun` writes the row + a `state_changed` event row, and
 *      emits no audit unless the entry state is `queued`.
 *   5. `transition` honors the legal-graph BEFORE the DB call.
 *   6. `transition` writes timestamps + the run_events row + the
 *      lifecycle audit row for every terminal-ish target state.
 *   7. The conditional UPDATE protects against a parallel-transition
 *      race (`WHERE status = $expectedFromState`).
 *   8. `recordEvent` and `listEvents` round-trip cleanly.
 *
 * Postgres-gated. When `PLASMAWORK_TEST_DB_URL` is unset the suite
 * skips with the L1.5 standard message; the unit-only "graph
 * sanity" suite below it runs unconditionally so even a no-DB
 * checkout exercises the static maps.
 */

import {
  describe,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
} from "vitest";

import {
  AuditLogger,
  type PreparedAuditRow,
} from "../../src/audit/logger.js";
import {
  RunStateMachine,
  RUN_STATES,
  RUN_TERMINAL_STATES,
  RUN_TRANSITIONS,
  isLegalTransition,
  type RunState,
} from "../../src/runs/stateMachine.js";
import {
  SecureCoreError,
  type ErrorCode,
} from "../../src/errors/shapes.js";
import {
  HAS_TEST_DB,
  createScratchDb,
  resetTestDb,
  bindFactories,
  type ScratchDb,
} from "../fixtures/index.js";

// ---------------------------------------------------------------------------
// Static-graph tests — run unconditionally (no DB needed).
// ---------------------------------------------------------------------------

describe("L3.6 — static state graph", () => {
  it("RUN_TRANSITIONS matches v4 §14 exactly", () => {
    const flat: Record<RunState, RunState[]> = {} as Record<
      RunState,
      RunState[]
    >;
    for (const state of RUN_STATES) {
      flat[state] = Array.from(RUN_TRANSITIONS[state]).sort();
    }
    expect(flat).toEqual({
      created: ["approval_required", "cancel_requested", "cancelled", "queued"],
      approval_required: ["cancel_requested", "cancelled", "queued"],
      queued: ["cancel_requested", "expired", "running"],
      running: ["cancel_requested", "completed", "failed", "paused"],
      paused: ["cancel_requested", "running"],
      cancel_requested: ["cancelled", "completed", "failed"],
      completed: [],
      failed: [],
      cancelled: [],
      expired: [],
    });
  });

  it("RUN_TERMINAL_STATES is exactly { completed, failed, cancelled, expired }", () => {
    expect(Array.from(RUN_TERMINAL_STATES).sort()).toEqual([
      "cancelled",
      "completed",
      "expired",
      "failed",
    ]);
    // Terminals have no outgoing edges.
    for (const t of RUN_TERMINAL_STATES) {
      expect(RUN_TRANSITIONS[t].size).toBe(0);
    }
  });

  it("isLegalTransition spot-checks boundary pairs", () => {
    // Six legal pairs.
    expect(isLegalTransition("created", "queued")).toBe(true);
    expect(isLegalTransition("queued", "running")).toBe(true);
    expect(isLegalTransition("running", "completed")).toBe(true);
    expect(isLegalTransition("running", "failed")).toBe(true);
    expect(isLegalTransition("paused", "running")).toBe(true);
    expect(isLegalTransition("cancel_requested", "cancelled")).toBe(true);

    // Six illegal pairs that the convention checker traps the
    // application from emitting.
    expect(isLegalTransition("created", "completed")).toBe(false);
    expect(isLegalTransition("queued", "completed")).toBe(false);
    expect(isLegalTransition("completed", "running")).toBe(false);
    expect(isLegalTransition("failed", "running")).toBe(false);
    expect(isLegalTransition("running", "queued")).toBe(false);
    expect(isLegalTransition("cancelled", "expired")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB-bound tests — gated on PLASMAWORK_TEST_DB_URL.
// ---------------------------------------------------------------------------

interface AuditHarness {
  logger: AuditLogger;
  rows: PreparedAuditRow[];
}

function makeAuditHarness(): AuditHarness {
  const rows: PreparedAuditRow[] = [];
  let prevHash: string | null = null;
  const logger = new AuditLogger({
    writer: async (row) => {
      rows.push(row);
      prevHash = row.row_hash;
    },
    prevHashGetter: async () => prevHash,
  });
  return { logger, rows };
}

describe.skipIf(!HAS_TEST_DB)("L3.6 — RunStateMachine (DB)", () => {
  let db: ScratchDb;

  beforeAll(async () => {
    db = await createScratchDb();
  }, 60_000);

  afterAll(async () => {
    await db?.cleanup();
  }, 30_000);

  beforeEach(async () => {
    await resetTestDb(db.sql);
  });

  /**
   * Build the minimal fixture graph every transition test needs:
   * user + workspace + capsule + version. Returns IDs the tests
   * thread through `createRun`.
   */
  async function makeFixtures(): Promise<{
    requesterId: string;
    workspaceId: string;
    capsuleId: string;
    capsuleVersionId: string;
  }> {
    const f = bindFactories(db.sql);
    const user = await f.makeUser();
    const ws = await f.makeWorkspace(user);
    const cap = await f.makeCapsule(ws, user);
    return {
      requesterId: user.id,
      workspaceId: ws.id,
      capsuleId: cap.capsule.id,
      capsuleVersionId: cap.version!.id,
    };
  }

  // 4. createRun happy path — no audit on `created` initial state.
  it("createRun(initialState='created') inserts the run + a state_changed event, no audit", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_test_create_default",
    });

    expect(run.status).toBe("created");

    const events = await sm.listEvents({ runId: run.id, workspaceId });
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe("state_changed");
    expect(events[0].metadata).toEqual({ from: null, to: "created" });

    expect(harness.rows.length).toBe(0);
  });

  // 5. createRun with initialState=queued emits run.launched.
  it("createRun(initialState='queued') emits a run.launched audit row", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_test_create_queued",
      initialState: "queued",
    });

    expect(run.status).toBe("queued");
    expect(harness.rows.length).toBe(1);
    expect(harness.rows[0].action).toBe("run.launched");
    expect(harness.rows[0].actor_user_id).toBe(requesterId);
    expect(harness.rows[0].object_id).toBe(run.id);
    expect(harness.rows[0].result).toBe("succeeded");
  });

  // 6. transition created → queued: row updated, run_events written, no
  // audit (queued isn't a launch beacon — only running is).
  it("transition(created → queued) updates the row and writes run_events but emits no audit", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_create",
    });
    expect(harness.rows.length).toBe(0);

    const updated = await sm.transition({
      runId: run.id,
      workspaceId,
      expectedFromState: "created",
      toState: "queued",
      actorUserId: requesterId,
      actorType: "human",
      requestId: "req_transition_q",
    });

    expect(updated.status).toBe("queued");
    expect(updated.started_at).toBeNull();
    expect(updated.finished_at).toBeNull();
    expect(harness.rows.length).toBe(0);

    const events = await sm.listEvents({ runId: run.id, workspaceId });
    // create event + transition event
    expect(events.length).toBe(2);
    expect(events[1].metadata).toEqual({ from: "created", to: "queued" });
  });

  // 7. transition queued → running: started_at set, run.launched audit.
  it("transition(queued → running) sets started_at and emits run.launched", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_create",
      initialState: "queued",
    });
    // The createRun(queued) path already emitted run.launched once.
    expect(harness.rows.length).toBe(1);

    const running = await sm.transition({
      runId: run.id,
      workspaceId,
      expectedFromState: "queued",
      toState: "running",
      actorUserId: requesterId,
      actorType: "worker",
      requestId: "req_transition_run",
    });

    expect(running.status).toBe("running");
    expect(running.started_at).not.toBeNull();
    // Per advisor: every transition into `running` emits run.launched.
    expect(harness.rows.length).toBe(2);
    expect(harness.rows[1].action).toBe("run.launched");
    expect(harness.rows[1].actor_type).toBe("worker");
  });

  // 8. transition running → completed: finished_at set, run.completed audit.
  it("transition(running → completed) sets finished_at and emits run.completed", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_create",
      initialState: "queued",
    });
    await sm.transition({
      runId: run.id,
      workspaceId,
      expectedFromState: "queued",
      toState: "running",
      actorUserId: requesterId,
      actorType: "worker",
      requestId: "req_run",
    });

    const completed = await sm.transition({
      runId: run.id,
      workspaceId,
      expectedFromState: "running",
      toState: "completed",
      actorUserId: requesterId,
      actorType: "worker",
      requestId: "req_done",
    });

    expect(completed.status).toBe("completed");
    expect(completed.finished_at).not.toBeNull();
    // Two run.launched (createRun(queued) + queued→running) + run.completed.
    expect(harness.rows.length).toBe(3);
    expect(harness.rows[2].action).toBe("run.completed");
    expect(harness.rows[2].result).toBe("succeeded");
  });

  // 9. Illegal transition is rejected BEFORE any DB call — no row mutation,
  // no run_events row, no audit row.
  it("transition rejects illegal pairs before touching the DB (created → completed)", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_create",
    });

    let captured: SecureCoreError | null = null;
    try {
      await sm.transition({
        runId: run.id,
        workspaceId,
        expectedFromState: "created",
        toState: "completed",
        actorUserId: requesterId,
        actorType: "human",
        requestId: "req_bad",
      });
    } catch (err) {
      captured = err as SecureCoreError;
    }
    expect(captured).not.toBeNull();
    expect((captured as SecureCoreError).code).toBe<ErrorCode>("INPUT_INVALID");

    // Row is still in `created`; events list still has only the create row.
    const events = await sm.listEvents({ runId: run.id, workspaceId });
    expect(events.length).toBe(1);
    expect(harness.rows.length).toBe(0);

    const status = await db.sql<{ status: string }[]>`
      SELECT status FROM simulation_runs WHERE id = ${run.id}
    `;
    expect(status[0].status).toBe("created");
  });

  // 10. Stale expectedFromState — DB row already advanced. The conditional
  // UPDATE returns 0 rows; the discrimination SELECT finds the row and
  // throws VERSION_CONFLICT.
  it("transition with stale expectedFromState raises VERSION_CONFLICT", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_create",
    });
    // Advance the row so the next caller's expectedFromState is stale.
    await sm.transition({
      runId: run.id,
      workspaceId,
      expectedFromState: "created",
      toState: "queued",
      actorUserId: requesterId,
      actorType: "human",
      requestId: "req_advance",
    });

    let captured: SecureCoreError | null = null;
    try {
      await sm.transition({
        runId: run.id,
        workspaceId,
        expectedFromState: "created",
        toState: "queued",
        actorUserId: requesterId,
        actorType: "human",
        requestId: "req_stale",
      });
    } catch (err) {
      captured = err as SecureCoreError;
    }
    expect(captured).not.toBeNull();
    expect((captured as SecureCoreError).code).toBe<ErrorCode>(
      "VERSION_CONFLICT",
    );
    expect((captured as SecureCoreError).details).toMatchObject({
      expected_from_state: "created",
      actual_state: "queued",
    });
  });

  // 11. Unknown runId — discrimination SELECT finds nothing → NOT_FOUND.
  it("transition with unknown runId raises NOT_FOUND", async () => {
    const { workspaceId } = await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const bogusId = "00000000-0000-4000-9000-000000000000";
    let captured: SecureCoreError | null = null;
    try {
      await sm.transition({
        runId: bogusId,
        workspaceId,
        expectedFromState: "created",
        toState: "queued",
        actorUserId: null,
        actorType: "worker",
        requestId: "req_404",
      });
    } catch (err) {
      captured = err as SecureCoreError;
    }
    expect(captured).not.toBeNull();
    expect((captured as SecureCoreError).code).toBe<ErrorCode>("NOT_FOUND");
  });

  // 12. Concurrent race: two callers both try queued → running. Exactly
  // one wins (returns the row); the other sees zero updated rows and
  // discriminates to VERSION_CONFLICT (since the winner advanced the
  // row to `running`).
  it("two concurrent transitions queued → running: exactly one wins", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_create",
      initialState: "queued",
    });

    const launcher = (label: string): Promise<RunState> =>
      sm
        .transition({
          runId: run.id,
          workspaceId,
          expectedFromState: "queued",
          toState: "running",
          actorUserId: requesterId,
          actorType: "worker",
          requestId: `req_race_${label}`,
        })
        .then((r): RunState => r.status);

    const settled = await Promise.allSettled([launcher("a"), launcher("b")]);
    const wins = settled.filter((s) => s.status === "fulfilled");
    const losses = settled.filter((s) => s.status === "rejected");
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(1);
    expect((wins[0] as PromiseFulfilledResult<RunState>).value).toBe("running");
    const loserErr = (losses[0] as PromiseRejectedResult).reason as
      | SecureCoreError
      | undefined;
    expect(loserErr?.code).toBe<ErrorCode>("VERSION_CONFLICT");
  });

  // 13. recordEvent appends without changing simulation_runs.status.
  it("recordEvent appends to run_events and leaves status untouched", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_create",
    });

    await sm.recordEvent({
      runId: run.id,
      workspaceId,
      eventType: "worker.heartbeat",
      message: "step 100/1000",
      metadata: { step: 100, total: 1000 },
    });

    const events = await sm.listEvents({ runId: run.id, workspaceId });
    expect(events.length).toBe(2); // create + heartbeat
    expect(events[1].event_type).toBe("worker.heartbeat");
    expect(events[1].message).toBe("step 100/1000");
    expect(events[1].metadata).toEqual({ step: 100, total: 1000 });

    const status = await db.sql<{ status: string }[]>`
      SELECT status FROM simulation_runs WHERE id = ${run.id}
    `;
    expect(status[0].status).toBe("created");
    expect(harness.rows.length).toBe(0);
  });

  // 14. listEvents respects offset/limit and chronological order.
  it("listEvents returns chronological order with offset+limit applied", async () => {
    const { requesterId, workspaceId, capsuleId, capsuleVersionId } =
      await makeFixtures();
    const harness = makeAuditHarness();
    const sm = new RunStateMachine({
      sql: db.sql,
      auditLogger: harness.logger,
    });

    const run = await sm.createRun({
      workspaceId,
      capsuleId,
      capsuleVersionId,
      backend: "python_cpu",
      requestedBy: requesterId,
      requestId: "req_create",
    });

    // Five heartbeats. Each insert is a separate statement so created_at
    // monotonically advances at microsecond resolution.
    for (let i = 1; i <= 5; i += 1) {
      await sm.recordEvent({
        runId: run.id,
        workspaceId,
        eventType: "worker.heartbeat",
        message: `step ${i}`,
      });
    }

    const all = await sm.listEvents({ runId: run.id, workspaceId });
    expect(all.length).toBe(6); // create + 5 heartbeats
    // Chronological: create row first, then heartbeats 1..5.
    expect(all[0].event_type).toBe("state_changed");
    expect(all[1].message).toBe("step 1");
    expect(all[5].message).toBe("step 5");

    const page = await sm.listEvents({
      runId: run.id,
      workspaceId,
      offset: 2,
      limit: 2,
    });
    expect(page.length).toBe(2);
    expect(page[0].message).toBe("step 2");
    expect(page[1].message).toBe("step 3");
  });
});

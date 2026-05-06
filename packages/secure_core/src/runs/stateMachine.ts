/**
 * Run state machine + persistence — Phase 0.5 Layer-3 (L3.6).
 *
 * Source: `secure_multi_user_scaffolding_plan_v4.md` §14 (Persistent
 * Run State).
 *
 * The DB only constrains the `simulation_runs.status` column to a
 * closed enum (the §11 CHECK). The legal *transitions* between those
 * statuses are enforced here, in application code, with a transition
 * table validated BEFORE any DB call AND a conditional UPDATE
 * (`WHERE status = $expectedFromState`) that is the race-safety net:
 * two callers racing the same transition will both attempt the UPDATE,
 * Postgres row-level locking serializes them, exactly one's WHERE
 * clause matches, and the loser sees zero rows updated and is forced
 * to discriminate "wrong from-state" from "row not found".
 *
 * Cross-task notes:
 *   - L3.7 (sandbox runner) drives transitions through this module —
 *     `running → completed`, `running → failed`, `cancel_requested →
 *     cancelled`. The runner never UPDATEs `simulation_runs` directly.
 *   - L4.3 (run-detail endpoint) reads via `listEvents` for the per-run
 *     event log shown in the UI.
 *   - L1.7 (audit logger) is the authoritative emitter for the four
 *     run-lifecycle audit events (`run.launched`, `run.cancelled`,
 *     `run.completed`, `run.failed`). The `run_events` ledger is
 *     diagnostic detail co-located with the run; it is NOT the audit
 *     trail and gets no chain-hash treatment.
 *
 * Constraints honored from the manifest §IMPLEMENTATION_MANIFEST.md and
 * the L3.6 task spec:
 *   - Validate inputs (legal-transition check) BEFORE any DB call.
 *   - Atomic conditional UPDATE — the `WHERE status = $expectedFromState`
 *     is the race protection. No advisory lock needed.
 *   - Audit emission happens AFTER the DB UPDATE succeeds; rejection
 *     paths from this module are state-machine errors and do NOT emit
 *     audit (the audit events here are about lifecycle, not denials).
 *   - Static maps are `Object.freeze`d to match the L1.1 pattern.
 */

import { randomUUID } from "node:crypto";
import type { JSONValue, Sql } from "postgres";

import type { AuditLogger } from "../audit/logger.js";
import type { AuditActorType } from "../audit/logger.js";
import {
  NotFoundError,
  InputInvalidError,
  VersionConflictError,
} from "../errors/shapes.js";

// ---------------------------------------------------------------------------
// State graph (v4 §14)
// ---------------------------------------------------------------------------

export const RUN_STATES = [
  "created",
  "approval_required",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
  "expired",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const RUN_STATE_SET: ReadonlySet<RunState> = Object.freeze(
  new Set(RUN_STATES),
);

/**
 * Terminal states have no outgoing transitions. Once a run reaches one
 * of these, its row is immutable except for append-only `run_events`
 * inserts via `recordEvent`. v4 §14 calls these out explicitly.
 *
 * `cancel_requested` is NOT terminal — it is an in-flight signal that
 * still resolves to `cancelled` (worker honored the cancel) or
 * `completed` / `failed` (worker finished before the cancel landed).
 */
export const RUN_TERMINAL_STATES: ReadonlySet<RunState> = Object.freeze(
  new Set<RunState>(["completed", "failed", "cancelled", "expired"]),
);

/**
 * Legal transitions per v4 §14. The map is keyed by the
 * `expectedFromState` and lists every legal `toState`. A state with no
 * outgoing edges (the four terminals) maps to an empty frozen set.
 *
 * The advisor flagged the spec's parenthetical "denied (= cancelled?)"
 * for `approval_required` — `denied` is NOT in `RUN_STATES` and NOT in
 * the DB CHECK enum, so approval denial collapses to `cancelled` here.
 */
export const RUN_TRANSITIONS: Readonly<Record<RunState, ReadonlySet<RunState>>> =
  Object.freeze({
    created: Object.freeze(
      new Set<RunState>([
        "approval_required",
        "queued",
        "cancel_requested",
        "cancelled",
      ]),
    ),
    approval_required: Object.freeze(
      new Set<RunState>(["queued", "cancel_requested", "cancelled"]),
    ),
    queued: Object.freeze(
      new Set<RunState>(["running", "cancel_requested", "expired"]),
    ),
    running: Object.freeze(
      new Set<RunState>([
        "paused",
        "completed",
        "failed",
        "cancel_requested",
      ]),
    ),
    paused: Object.freeze(new Set<RunState>(["running", "cancel_requested"])),
    cancel_requested: Object.freeze(
      new Set<RunState>(["cancelled", "completed", "failed"]),
    ),
    completed: Object.freeze(new Set<RunState>()),
    failed: Object.freeze(new Set<RunState>()),
    cancelled: Object.freeze(new Set<RunState>()),
    expired: Object.freeze(new Set<RunState>()),
  });

export function isRunState(value: unknown): value is RunState {
  return typeof value === "string" && RUN_STATE_SET.has(value as RunState);
}

export function isLegalTransition(from: RunState, to: RunState): boolean {
  const allowed = RUN_TRANSITIONS[from];
  if (allowed === undefined) {
    return false;
  }
  return allowed.has(to);
}

// ---------------------------------------------------------------------------
// Row + event shapes
// ---------------------------------------------------------------------------

/**
 * Every column on `simulation_runs` per L1.8 schema. The state machine
 * returns full rows from `createRun` / `transition` so callers (L3.7,
 * L4.3) get a single source of truth without a follow-up SELECT.
 */
export interface RunRow {
  id: string;
  workspace_id: string;
  capsule_id: string;
  capsule_version_id: string;
  status: RunState;
  backend: string;
  requested_by: string;
  approved_by: string | null;
  cancellation_reason: string | null;
  failure_message: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  canceled_at: Date | null;
}

/**
 * Append-only `run_events` row. Free-form `event_type` (caller bears the
 * burden of keeping it short and meaningful); the state-machine itself
 * emits rows with `event_type = "state_changed"` and a metadata payload
 * carrying `{ from, to, ... }`.
 */
export interface RunEventRow {
  id: string;
  workspace_id: string;
  run_id: string;
  event_type: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Public option shapes
// ---------------------------------------------------------------------------

export type RunActorType = Exclude<AuditActorType, "unauthenticated">;

/**
 * Initial state for a freshly-created run. v4 §14 allows a run to enter
 * the graph at one of three points:
 *   - `created` (default) — the run row exists but has not yet been
 *     classified as approval-required or queued.
 *   - `approval_required` — the launch path discovered a high-risk
 *     condition; the L2.9 middleware attaches an approval request and
 *     parks the run pending human review.
 *   - `queued` — the run is ready to execute the moment a worker picks
 *     it up (no approval required, no further classification step).
 */
export type RunInitialState = "created" | "approval_required" | "queued";

export interface CreateRunOptions {
  workspaceId: string;
  capsuleId: string;
  capsuleVersionId: string;
  backend: string;
  requestedBy: string;
  requestId: string;
  initialState?: RunInitialState;
}

export interface TransitionOptions {
  runId: string;
  workspaceId: string;
  expectedFromState: RunState;
  toState: RunState;
  actorUserId: string | null;
  actorType: RunActorType;
  requestId: string;
  /** Sets `cancellation_reason` on `cancel_requested` / `cancelled`. */
  cancellationReason?: string;
  /** Sets `failure_message` on `failed`. */
  failureMessage?: string;
  /**
   * Free-form payload merged into `run_events.metadata` alongside
   * `{ from, to }`. NOT redacted — `run_events.metadata` is jsonb and
   * is not part of the audit chain. Callers must keep it small.
   */
  metadata?: Record<string, unknown>;
}

export interface RecordEventOptions {
  runId: string;
  workspaceId: string;
  eventType: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface ListEventsOptions {
  runId: string;
  workspaceId: string;
  limit?: number;
  offset?: number;
}

export interface RunStateMachineOptions {
  /**
   * postgres-js `Sql` client. Production wires `pool.sql` from a
   * `SecureCorePool` (see `src/db/pool.ts`); tests pass the L1.5
   * fixture's `db.sql` directly. The state machine never holds a
   * transaction itself — every method runs as a single statement (or a
   * tightly-paired UPDATE + INSERT) against this client.
   */
  sql: Sql;
  auditLogger: AuditLogger;
  /** Deterministic clock for tests. Default: `() => new Date()`. */
  now?: () => Date;
  /** Deterministic UUID generator for tests. Default: `randomUUID`. */
  generateId?: () => string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Internal raw row shape — postgres-js returns columns as the snake_case
 * table column names, and we narrow `status` to `RunState` after fetch.
 */
interface RawRunRow {
  id: string;
  workspace_id: string;
  capsule_id: string;
  capsule_version_id: string;
  status: string;
  backend: string;
  requested_by: string;
  approved_by: string | null;
  cancellation_reason: string | null;
  failure_message: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  canceled_at: Date | null;
}

function narrowRunRow(raw: RawRunRow): RunRow {
  if (!isRunState(raw.status)) {
    // The DB CHECK constraint should make this impossible. If it fires,
    // a migration introduced a new status that the application doesn't
    // know about — fail loudly, don't silently coerce.
    throw new Error(
      `RunStateMachine: unexpected simulation_runs.status from DB: ${String(
        raw.status,
      )}`,
    );
  }
  return {
    id: raw.id,
    workspace_id: raw.workspace_id,
    capsule_id: raw.capsule_id,
    capsule_version_id: raw.capsule_version_id,
    status: raw.status,
    backend: raw.backend,
    requested_by: raw.requested_by,
    approved_by: raw.approved_by,
    cancellation_reason: raw.cancellation_reason,
    failure_message: raw.failure_message,
    created_at: raw.created_at,
    started_at: raw.started_at,
    finished_at: raw.finished_at,
    canceled_at: raw.canceled_at,
  };
}

export class RunStateMachine {
  private readonly sql: Sql;
  private readonly auditLogger: AuditLogger;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  public constructor(opts: RunStateMachineOptions) {
    this.sql = opts.sql;
    this.auditLogger = opts.auditLogger;
    this.now = opts.now ?? ((): Date => new Date());
    this.generateId = opts.generateId ?? ((): string => randomUUID());
  }

  /**
   * Insert a fresh `simulation_runs` row at one of the three entry
   * states (`created` / `approval_required` / `queued`), append a
   * matching `state_changed` event to `run_events`, and — if the entry
   * point is `queued` — emit a `run.launched` audit row.
   *
   * The `created` and `approval_required` entry points emit no audit
   * here; `approval.requested` lands separately via the L3.3 approval
   * service and is not this module's concern.
   */
  public async createRun(opts: CreateRunOptions): Promise<RunRow> {
    const initialState: RunInitialState = opts.initialState ?? "created";
    if (
      initialState !== "created" &&
      initialState !== "approval_required" &&
      initialState !== "queued"
    ) {
      // Defense-in-depth against a cast at the call site. The TypeScript
      // type already narrows, but the closed enum check keeps a runtime
      // safety net.
      throw new InputInvalidError(
        "RunStateMachine.createRun: invalid initialState.",
        { initial_state: initialState },
      );
    }

    const id = this.generateId();
    const inserted = await this.sql<RawRunRow[]>`
      INSERT INTO simulation_runs (
        id, workspace_id, capsule_id, capsule_version_id,
        status, backend, requested_by
      ) VALUES (
        ${id}, ${opts.workspaceId}, ${opts.capsuleId}, ${opts.capsuleVersionId},
        ${initialState}, ${opts.backend}, ${opts.requestedBy}
      )
      RETURNING id, workspace_id, capsule_id, capsule_version_id,
                status, backend, requested_by, approved_by,
                cancellation_reason, failure_message,
                created_at, started_at, finished_at, canceled_at
    `;
    const run = narrowRunRow(inserted[0]);

    await this.insertRunEvent({
      runId: run.id,
      workspaceId: run.workspace_id,
      eventType: "state_changed",
      message: null,
      metadata: { from: null, to: initialState },
    });

    if (initialState === "queued") {
      await this.auditLogger.write({
        workspaceId: run.workspace_id,
        actorUserId: opts.requestedBy,
        actorType: "human",
        action: "run.launched",
        objectType: "run",
        objectId: run.id,
        result: "succeeded",
        requestId: opts.requestId,
        metadata: {},
      });
    }

    return run;
  }

  /**
   * Conditional state transition. The flow is:
   *
   *   1. Validate `expectedFromState → toState` against the static
   *      transition table. Illegal pair → `InputInvalidError`. No DB
   *      contact.
   *   2. UPDATE `simulation_runs` with a `WHERE status =
   *      $expectedFromState` predicate. The SET clause sets the
   *      side-channel timestamps for the target state and merges
   *      cancellation / failure fields via COALESCE so a re-run of the
   *      same transition (the event-sourcing-style replay path) does
   *      not clobber the prior reason.
   *   3. If the UPDATE returned 0 rows, SELECT the row to discriminate
   *      "row not found" (`NotFoundError`) from "row exists but its
   *      current status is not `expectedFromState`" (`VersionConflictError`).
   *      The DB-side row-level lock guarantees that two callers racing
   *      the same transition both attempt the UPDATE, exactly one wins,
   *      and the loser's discrimination SELECT sees the winner's state.
   *   4. Append `run_events` with `event_type = "state_changed"`.
   *   5. Emit the matching audit row for `running` / `cancelled` /
   *      `completed` / `failed`. Per the advisor, `run.launched` fires
   *      on every transition into `running`; we do not try to dedupe
   *      across paused→running re-entries.
   */
  public async transition(opts: TransitionOptions): Promise<RunRow> {
    if (!isRunState(opts.expectedFromState)) {
      throw new InputInvalidError(
        "RunStateMachine.transition: invalid expectedFromState.",
        { from: opts.expectedFromState },
      );
    }
    if (!isRunState(opts.toState)) {
      throw new InputInvalidError(
        "RunStateMachine.transition: invalid toState.",
        { to: opts.toState },
      );
    }
    if (!isLegalTransition(opts.expectedFromState, opts.toState)) {
      throw new InputInvalidError("Illegal run state transition.", {
        from: opts.expectedFromState,
        to: opts.toState,
      });
    }

    const cancellationReason = opts.cancellationReason ?? null;
    const failureMessage = opts.failureMessage ?? null;
    const toState = opts.toState;

    // The conditional UPDATE. Postgres' COALESCE is intentional on
    // started_at / finished_at / canceled_at so that a transition that
    // does NOT touch the timestamp leaves it alone, and a re-entry into
    // an already-stamped state does not clobber the original timestamp.
    const updated = await this.sql<RawRunRow[]>`
      UPDATE simulation_runs
      SET status = ${toState},
          started_at = COALESCE(
            started_at,
            CASE WHEN ${toState} = 'running' THEN now() ELSE NULL END
          ),
          finished_at = CASE
            WHEN ${toState} IN ('completed', 'failed', 'expired')
              THEN COALESCE(finished_at, now())
            ELSE finished_at
          END,
          canceled_at = CASE
            WHEN ${toState} = 'cancelled'
              THEN COALESCE(canceled_at, now())
            ELSE canceled_at
          END,
          cancellation_reason = COALESCE(${cancellationReason}, cancellation_reason),
          failure_message = COALESCE(${failureMessage}, failure_message)
      WHERE id = ${opts.runId}
        AND workspace_id = ${opts.workspaceId}
        AND status = ${opts.expectedFromState}
      RETURNING id, workspace_id, capsule_id, capsule_version_id,
                status, backend, requested_by, approved_by,
                cancellation_reason, failure_message,
                created_at, started_at, finished_at, canceled_at
    `;

    if (updated.length === 0) {
      // Discriminate not-found vs wrong-from-state.
      const existing = await this.sql<{ status: string }[]>`
        SELECT status
        FROM simulation_runs
        WHERE id = ${opts.runId} AND workspace_id = ${opts.workspaceId}
        LIMIT 1
      `;
      if (existing.length === 0) {
        throw new NotFoundError("Run not found.", {
          run_id: opts.runId,
        });
      }
      throw new VersionConflictError(
        "Run state has advanced; transition rejected.",
        {
          expected_from_state: opts.expectedFromState,
          actual_state: existing[0].status,
        },
      );
    }

    const run = narrowRunRow(updated[0]);

    // Free-form run_events payload — NOT routed through the audit
    // metadata redactor. The advisor flagged that `from`/`to` are not
    // allowlisted for audit metadata; `run_events.metadata` has no such
    // restriction.
    await this.insertRunEvent({
      runId: run.id,
      workspaceId: run.workspace_id,
      eventType: "state_changed",
      message: null,
      metadata: {
        from: opts.expectedFromState,
        to: toState,
        ...(opts.metadata ?? {}),
      },
    });

    // Audit emission. The L3.6 spec maps four target states to events.
    // Other transitions (e.g. queued / paused / cancel_requested) emit
    // run_events but no audit — the audit chain captures lifecycle
    // milestones, not every intermediate step.
    if (toState === "running") {
      await this.auditLogger.write({
        workspaceId: run.workspace_id,
        actorUserId: opts.actorUserId,
        actorType: opts.actorType,
        action: "run.launched",
        objectType: "run",
        objectId: run.id,
        result: "succeeded",
        requestId: opts.requestId,
        metadata: {},
      });
    } else if (toState === "cancelled") {
      await this.auditLogger.write({
        workspaceId: run.workspace_id,
        actorUserId: opts.actorUserId,
        actorType: opts.actorType,
        action: "run.cancelled",
        objectType: "run",
        objectId: run.id,
        result: "succeeded",
        requestId: opts.requestId,
        metadata: {},
      });
    } else if (toState === "completed") {
      await this.auditLogger.write({
        workspaceId: run.workspace_id,
        actorUserId: opts.actorUserId,
        actorType: opts.actorType,
        action: "run.completed",
        objectType: "run",
        objectId: run.id,
        result: "succeeded",
        requestId: opts.requestId,
        metadata: {},
      });
    } else if (toState === "failed") {
      await this.auditLogger.write({
        workspaceId: run.workspace_id,
        actorUserId: opts.actorUserId,
        actorType: opts.actorType,
        action: "run.failed",
        objectType: "run",
        objectId: run.id,
        result: "failed",
        requestId: opts.requestId,
        metadata: {},
      });
    }

    return run;
  }

  /**
   * Append a free-form diagnostic event. NOT a state transition;
   * `simulation_runs.status` is not touched. Worker progress beacons
   * (e.g. step counters, intermediate diagnostics) flow through here.
   *
   * The caller bears the burden of keeping `eventType` short — we don't
   * enforce a closed enum because the diagnostic surface is open by
   * design (each module can define its own event names).
   */
  public async recordEvent(opts: RecordEventOptions): Promise<void> {
    await this.insertRunEvent({
      runId: opts.runId,
      workspaceId: opts.workspaceId,
      eventType: opts.eventType,
      message: opts.message ?? null,
      metadata: opts.metadata ?? null,
    });
  }

  /**
   * Paginated listing for the run-detail view (L4.3). Order is
   * chronological with a secondary `id ASC` tiebreaker; both arguments
   * are clamped to safe ranges.
   */
  public async listEvents(opts: ListEventsOptions): Promise<RunEventRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = await this.sql<RunEventRow[]>`
      SELECT id, workspace_id, run_id, event_type, message, metadata,
             created_at
      FROM run_events
      WHERE run_id = ${opts.runId} AND workspace_id = ${opts.workspaceId}
      ORDER BY created_at ASC, id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows;
  }

  /**
   * Single insert into `run_events`. Centralized so every emission path
   * (createRun, transition, recordEvent) wraps `metadata` through
   * `sql.json` consistently — postgres-js will otherwise serialize the
   * object as `[object Object]` for the jsonb column.
   *
   * `created_at` is set from the injected `this.now()` clock so tests
   * that need a deterministic ordering can pin both the run-event
   * timestamps and the audit-event timestamps to the same source. In
   * production both default to `new Date()`.
   */
  private async insertRunEvent(opts: {
    runId: string;
    workspaceId: string;
    eventType: string;
    message: string | null;
    metadata: Record<string, unknown> | null;
  }): Promise<void> {
    const id = this.generateId();
    // postgres-js `JSONValue` is strict about runtime types; the
    // metadata reaching this seam has either already passed JCS-shaped
    // validation upstream (state-machine internal callers) OR is the
    // free-form `recordEvent` payload whose runtime shape is the
    // caller's responsibility. The cast mirrors `asJsonbParam` in
    // `src/audit/dbWriter.ts`.
    const metadataParam =
      opts.metadata === null
        ? null
        : this.sql.json(opts.metadata as JSONValue);
    const createdAt = this.now();
    await this.sql`
      INSERT INTO run_events (
        id, workspace_id, run_id, event_type, message, metadata, created_at
      ) VALUES (
        ${id}, ${opts.workspaceId}, ${opts.runId}, ${opts.eventType},
        ${opts.message}, ${metadataParam}, ${createdAt}
      )
    `;
  }
}

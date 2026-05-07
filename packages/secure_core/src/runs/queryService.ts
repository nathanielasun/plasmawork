/**
 * Run-side read queries — Phase 0.5 Layer 4 task L4.3.
 *
 * The L3.6 `RunStateMachine` owns every WRITE path on `simulation_runs`
 * (the conditional UPDATE is the race-safety net) and the
 * `recordEvent` / `listEvents` diagnostic ledger. The HTTP surface in
 * `routes/runs.ts` additionally needs three SELECTs that the state
 * machine intentionally does NOT expose:
 *
 *   - `listRuns` for `GET /workspaces/:workspaceId/runs` with the
 *     `?status=&capsuleId=&limit=&cursor=` filter set. Keyset
 *     pagination on `(created_at DESC, id DESC)` mirrors L4.7.
 *
 *   - `getRunOrThrow` for `GET /workspaces/:workspaceId/runs/:runId`.
 *     Workspace-scoped; refuses cross-workspace IDs with NotFoundError
 *     so the L2 uniform-not-found contract is upheld at the data layer.
 *
 *   - `getRunStateForCancel` for the cancel route's pre-transition
 *     SELECT. The cancel endpoint reads the current state, then asks
 *     the state machine to flip it to `cancel_requested` with that
 *     state as `expectedFromState`. The conditional UPDATE inside the
 *     state machine is the actual race protection — this SELECT is the
 *     "what state is it now?" lookup needed to populate the kwarg.
 *
 *   - `getCapsuleForRunCreate` validates the capsule exists in this
 *     workspace, isn't soft-deleted, and resolves a default
 *     `capsule_version_id` from `capsules.current_version_id`. v4 §4.1
 *     requires the route to refuse a body-supplied version that does
 *     not belong to this capsule, so the helper accepts an optional
 *     `expectedVersionId` and (when provided) verifies it matches a row
 *     in `capsule_versions` for this capsule.
 *
 * The state machine is left untouched per task constraints — every
 * SELECT this module needs is colocated here so the L3.6 module's
 * write-path surface remains minimal.
 */

import type { Sql } from "postgres";

import {
  NotFoundError,
  InputInvalidError,
} from "../errors/shapes.js";
import {
  isRunState,
  type RunRow,
  type RunState,
} from "./stateMachine.js";

// ---------------------------------------------------------------------------
// Public option / result shapes
// ---------------------------------------------------------------------------

/** Opaque keyset cursor — same shape as L4.7's `KeysetCursor`. */
export interface RunKeysetCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface ListRunsOptions {
  readonly limit: number;
  readonly cursor?: RunKeysetCursor;
  readonly status?: RunState;
  readonly capsuleId?: string;
}

export interface ListRunsResult {
  readonly rows: RunRow[];
  readonly nextCursor: RunKeysetCursor | null;
}

/**
 * Result of `getCapsuleForRunCreate`. The caller uses
 * `resolvedVersionId` to fill `CreateRunOptions.capsuleVersionId`.
 */
export interface CapsuleForRunCreate {
  readonly capsuleId: string;
  readonly resolvedVersionId: string;
}

export interface RunQueryServiceOptions {
  readonly sql: Sql;
}

// ---------------------------------------------------------------------------
// Internal raw row shape (postgres-js returns snake_case columns)
// ---------------------------------------------------------------------------

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
    throw new Error(
      `RunQueryService: unexpected simulation_runs.status from DB: ${String(
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RunQueryService {
  private readonly sql: Sql;

  public constructor(opts: RunQueryServiceOptions) {
    this.sql = opts.sql;
  }

  /**
   * Keyset-paginated list of runs in a workspace. The optional `status`
   * and `capsuleId` filters are AND-composed; postgres-js parameterizes
   * via the tagged-template substitution so there is no SQL injection
   * surface. The `limit + 1` over-fetch trick is identical to L4.7:
   * if the (limit+1)th row comes back, drop it and use the Nth row's
   * `(created_at, id)` as `nextCursor`.
   */
  public async listRuns(
    workspaceId: string,
    opts: ListRunsOptions,
  ): Promise<ListRunsResult> {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) {
      throw new InputInvalidError("limit must be a positive integer.", {
        field: "limit",
      });
    }

    const fetchLimit = opts.limit + 1;
    const status = opts.status ?? null;
    const capsuleId = opts.capsuleId ?? null;
    const cursorCreatedAt = opts.cursor?.createdAt ?? null;
    const cursorId = opts.cursor?.id ?? null;

    // Single SQL with all filter knobs expressed as nullable parameters.
    // Each AND clause short-circuits when the parameter is null. The
    // `(created_at, id) < (?, ?)` keyset predicate excludes the cursor
    // row itself — same contract as the L4.7 `AuditReadService`.
    const rows = await this.sql<RawRunRow[]>`
      SELECT id, workspace_id, capsule_id, capsule_version_id,
             status, backend, requested_by, approved_by,
             cancellation_reason, failure_message,
             created_at, started_at, finished_at, canceled_at
      FROM simulation_runs
      WHERE workspace_id = ${workspaceId}
        AND (${status}::text IS NULL OR status = ${status})
        AND (${capsuleId}::uuid IS NULL OR capsule_id = ${capsuleId})
        AND (
          ${cursorCreatedAt}::timestamptz IS NULL
          OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
        )
      ORDER BY created_at DESC, id DESC
      LIMIT ${fetchLimit}
    `;

    const hasMore = rows.length > opts.limit;
    const surviving = hasMore ? rows.slice(0, opts.limit) : rows;
    const narrowed = surviving.map(narrowRunRow);
    const nextCursor =
      hasMore && narrowed.length > 0
        ? {
            createdAt: narrowed[narrowed.length - 1].created_at,
            id: narrowed[narrowed.length - 1].id,
          }
        : null;
    return { rows: narrowed, nextCursor };
  }

  /**
   * Workspace-scoped fetch. Returns the run row or throws
   * `NotFoundError` — the L2 uniform-not-found middleware sees the same
   * shape the route surface emits when a UUID doesn't match anything.
   */
  public async getRunOrThrow(
    workspaceId: string,
    runId: string,
  ): Promise<RunRow> {
    const rows = await this.sql<RawRunRow[]>`
      SELECT id, workspace_id, capsule_id, capsule_version_id,
             status, backend, requested_by, approved_by,
             cancellation_reason, failure_message,
             created_at, started_at, finished_at, canceled_at
      FROM simulation_runs
      WHERE id = ${runId} AND workspace_id = ${workspaceId}
      LIMIT 1
    `;
    if (rows.length === 0) {
      throw new NotFoundError("Run not found.", { run_id: runId });
    }
    return narrowRunRow(rows[0]);
  }

  /**
   * Lightweight SELECT for the cancel pre-transition step. Returns the
   * current `status` so the route can pass it to the state machine as
   * `expectedFromState`. The conditional UPDATE inside the state
   * machine is the actual race protection: if the status drifts between
   * this SELECT and the UPDATE, the UPDATE returns 0 rows and the state
   * machine raises `VersionConflictError` (mapped to 409).
   */
  public async getRunStateForCancel(
    workspaceId: string,
    runId: string,
  ): Promise<RunState> {
    const rows = await this.sql<{ status: string }[]>`
      SELECT status
      FROM simulation_runs
      WHERE id = ${runId} AND workspace_id = ${workspaceId}
      LIMIT 1
    `;
    if (rows.length === 0) {
      throw new NotFoundError("Run not found.", { run_id: runId });
    }
    const status = rows[0].status;
    if (!isRunState(status)) {
      throw new Error(
        `RunQueryService: unexpected simulation_runs.status: ${String(status)}`,
      );
    }
    return status;
  }

  /**
   * Defense-in-depth check the route does BEFORE asking the state
   * machine to insert a fresh run. The state machine trusts its inputs
   * (L3.6 design), so the route MUST validate that:
   *
   *   1. The capsule exists in this workspace and is not soft-deleted.
   *   2. If the body supplied a `capsule_version_id`, that version row
   *      exists AND belongs to this capsule. The route must NEVER trust
   *      a body-supplied version that points at another capsule's
   *      history.
   *   3. Otherwise default the version to the capsule's
   *      `current_version_id` — refuse with NotFoundError if the
   *      capsule has no head version yet (a freshly-inserted capsule
   *      with no v1 should not be runnable).
   */
  public async getCapsuleForRunCreate(opts: {
    workspaceId: string;
    capsuleId: string;
    expectedVersionId?: string;
  }): Promise<CapsuleForRunCreate> {
    const capsule = await this.sql<
      { id: string; current_version_id: string | null; deleted_at: Date | null }[]
    >`
      SELECT id, current_version_id, deleted_at
      FROM capsules
      WHERE id = ${opts.capsuleId} AND workspace_id = ${opts.workspaceId}
      LIMIT 1
    `;
    if (capsule.length === 0 || capsule[0].deleted_at !== null) {
      throw new NotFoundError("Capsule not found.", {
        capsule_id: opts.capsuleId,
      });
    }
    const head = capsule[0];

    if (opts.expectedVersionId !== undefined) {
      // Body supplied a version; verify it belongs to this capsule.
      const version = await this.sql<{ id: string }[]>`
        SELECT id
        FROM capsule_versions
        WHERE id = ${opts.expectedVersionId}
          AND capsule_id = ${opts.capsuleId}
        LIMIT 1
      `;
      if (version.length === 0) {
        throw new NotFoundError(
          "Capsule version not found for this capsule.",
          {
            capsule_id: opts.capsuleId,
            capsule_version_id: opts.expectedVersionId,
          },
        );
      }
      return {
        capsuleId: head.id,
        resolvedVersionId: opts.expectedVersionId,
      };
    }

    if (head.current_version_id === null) {
      throw new NotFoundError("Capsule has no current version.", {
        capsule_id: opts.capsuleId,
      });
    }
    return {
      capsuleId: head.id,
      resolvedVersionId: head.current_version_id,
    };
  }
}

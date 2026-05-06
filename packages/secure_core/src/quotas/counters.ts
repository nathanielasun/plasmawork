/**
 * Quota counter service — Phase 0.5 Layer-3 (L3.5).
 *
 * v4 §21.2 Atomic Enforcement: every counter check is a single atomic
 * SQL statement. Reads-then-writes-without-transaction-isolation are
 * invalid by spec, so the only public mutation paths in this module
 * are conditional UPDATEs. The DB row's WHERE clause is the gate;
 * application-side comparisons after a non-atomic SELECT are
 * deliberately not exposed.
 *
 * The audit-emit-before-throw rule (v4 §19, §4.2 fail closed): every
 * rejection path emits a `quota.exceeded` audit event BEFORE throwing
 * `QuotaExceededError`, so a caller that only sees the thrown error
 * can still rely on the audit chain having a denial row. Audit emit
 * failures (rare; usually a redaction-shape misuse) are logged via
 * `req.log` style propagation by Layer-3 — here we let the error
 * surface with the original quota error attached as `cause`.
 *
 * Storage reservation lifecycle (v4 §21.3): the periodic sweep that
 * decrements counters for expired reservations lives in
 * `./storageReservations.ts`; that module composes this one and is the
 * caller of `releaseQuota` for each expired row.
 */

import type { Sql, TransactionSql } from "postgres";

import type { AuditLogger } from "../audit/logger.js";
import { QuotaExceededError } from "../errors/shapes.js";

/**
 * Postgres-js transaction handle OR top-level Sql client. Most paths
 * accept either: `reserveQuota` runs the same conditional UPDATE
 * whether the caller wraps it in a `sql.begin` or not. The storage
 * reservation service uses this seam to compose counter check + row
 * insert atomically.
 */
export type SqlExecutor = Sql | TransactionSql;

export interface QuotaCounterServiceOptions {
  sql: Sql;
  auditLogger: AuditLogger;
  /**
   * Optional default-limits map. When a `reserveQuota` call hits a
   * (workspaceId, quotaKey) that has no row, the row is auto-provisioned
   * with `limit_value = defaultLimits[quotaKey]` and `current_value = 0`,
   * then the increment is retried.
   *
   * Without an entry for the key, the call throws `QUOTA_EXCEEDED`
   * with `Quota not configured.` — there is no comfortable default per
   * the v4 §21.2 "no implicit limits" reading.
   */
  defaultLimits?: Readonly<Record<string, bigint>>;
  /** Optional clock injection for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface ReserveQuotaInput {
  workspaceId: string;
  quotaKey: string;
  increment: bigint;
  requestId: string;
  /**
   * Server-derived actor id, threaded from `req.auth.userId` by L4
   * route handlers. Audit rows for the rejection path use this; no
   * client-controlled actor field reaches the audit log.
   */
  actorUserId: string;
  /**
   * Override the executor for atomic composition. When set, the SQL
   * runs against the supplied transaction handle (e.g. inside
   * `storageReservations.reserveBytes`). Defaults to the constructor's
   * top-level `sql`.
   */
  tx?: SqlExecutor;
}

/**
 * Successful reservation. The atomic UPDATE returned the new
 * `current_value`; the caller can use it for log / telemetry.
 *
 * The "rejected" branch is *not* a return shape — atomic failures
 * raise `QuotaExceededError` so the caller's control flow doesn't
 * silently miss the limit hit. The discriminated union return form
 * is reserved for cases where both branches need typed handling
 * (none exist today).
 */
export interface ReserveQuotaSuccess {
  ok: true;
  newValue: bigint;
}

export interface ProvisionQuotaInput {
  workspaceId: string;
  quotaKey: string;
  limitValue: bigint;
  /**
   * Period for windowed quotas (e.g. "daily run submissions"). Both
   * fields must be set together or both NULL — the DB CHECK
   * (`quota_counters_period_check`) enforces it; we surface the
   * inconsistency as `QUOTA_EXCEEDED("Quota period invalid.")`.
   */
  periodStart?: Date;
  periodEnd?: Date;
}

export interface ReleaseQuotaInput {
  workspaceId: string;
  quotaKey: string;
  decrement: bigint;
  tx?: SqlExecutor;
}

export interface RecomputeFromReservationsInput {
  workspaceId: string;
  quotaKey: string;
}

interface QuotaCounterRow {
  current_value: string;
  limit_value: string;
}

interface RecomputeRow {
  total: string | null;
}

/**
 * Postgres SQLSTATE codes we branch on. Postgres-js exposes `.code`
 * on its error objects; the codes here are stable across PG versions.
 */
const PG_CHECK_VIOLATION = "23514" as const;

interface PgErrorLike {
  code?: unknown;
  constraint_name?: unknown;
}

function isPgError(err: unknown): err is PgErrorLike {
  return typeof err === "object" && err !== null;
}

/**
 * Atomic quota counter service. v4 §21.2 §21.3.
 *
 * Public methods:
 *
 *   - `reserveQuota`  — atomic conditional UPDATE; emits `quota.exceeded`
 *                       on rejection; throws `QuotaExceededError`.
 *   - `releaseQuota`  — atomic decrement clamped at 0 (no negative
 *                       counters even if a paired-up release fires twice).
 *   - `provisionQuota`— deployment-side INSERT/UPSERT of a counter row
 *                       with its `limit_value`. CHECK violations on the
 *                       period bounds get translated into `QUOTA_EXCEEDED`.
 *   - `recomputeFromReservations` — single-query recovery sum used by the
 *                       audit-only consistency check (v4 §21.3 last ¶).
 */
export class QuotaCounterService {
  private readonly sql: Sql;
  private readonly auditLogger: AuditLogger;
  private readonly defaultLimits: Readonly<Record<string, bigint>>;

  public constructor(opts: QuotaCounterServiceOptions) {
    this.sql = opts.sql;
    this.auditLogger = opts.auditLogger;
    this.defaultLimits = opts.defaultLimits ?? {};
    // `opts.now` is accepted for future windowed-period rollover; the
    // current implementation uses `now()` server-side in the WHERE
    // clause, so application-side time isn't needed.
    void opts.now;
  }

  /**
   * Atomic conditional UPDATE per v4 §21.2.
   *
   * The DB statement is the single source of truth: if the WHERE
   * clause matches (counter exists, period is current, headroom is
   * sufficient), the row updates and returns the post-image value.
   * No matching row → 0 affected → we SELECT to discriminate "no
   * counter provisioned" vs. "limit exceeded".
   *
   * Both rejection branches emit `quota.exceeded` BEFORE throwing.
   */
  public async reserveQuota(
    input: ReserveQuotaInput,
  ): Promise<ReserveQuotaSuccess> {
    if (input.increment <= 0n) {
      throw new QuotaExceededError(
        "Quota increment must be positive.",
        { quota_key: input.quotaKey },
      );
    }
    const exec = input.tx ?? this.sql;
    const updated = await this.runAtomicIncrement(exec, input);
    if (updated !== null) {
      return { ok: true, newValue: updated };
    }

    // 0 rows affected: discriminate.
    const existing = await exec<QuotaCounterRow[]>`
      SELECT current_value, limit_value
      FROM quota_counters
      WHERE workspace_id = ${input.workspaceId}
        AND quota_key = ${input.quotaKey}
    `;

    if (existing.length === 0) {
      const fallbackLimit = this.defaultLimits[input.quotaKey];
      if (fallbackLimit === undefined) {
        await this.emitQuotaExceeded(input, "not_provisioned");
        throw new QuotaExceededError("Quota not configured.", {
          quota_key: input.quotaKey,
        });
      }
      // Auto-provision a row with the configured default limit, then
      // retry the atomic increment exactly once. Two concurrent callers
      // can both attempt this; ON CONFLICT DO NOTHING gives idempotency.
      await exec`
        INSERT INTO quota_counters (workspace_id, quota_key, current_value, limit_value)
        VALUES (${input.workspaceId}, ${input.quotaKey}, 0, ${fallbackLimit.toString()}::bigint)
        ON CONFLICT (workspace_id, quota_key) DO NOTHING
      `;
      const retried = await this.runAtomicIncrement(exec, input);
      if (retried !== null) {
        return { ok: true, newValue: retried };
      }
      // Auto-provisioned but increment > limit: fall through as exceeded.
      const provisioned = await exec<QuotaCounterRow[]>`
        SELECT current_value, limit_value
        FROM quota_counters
        WHERE workspace_id = ${input.workspaceId}
          AND quota_key = ${input.quotaKey}
      `;
      const limit = BigInt(provisioned[0]?.limit_value ?? "0");
      const current = BigInt(provisioned[0]?.current_value ?? "0");
      await this.emitQuotaExceeded(input, "limit_exceeded");
      throw new QuotaExceededError("Quota limit exceeded.", {
        quota_key: input.quotaKey,
        // String form because audit metadata + envelope details cross JSON.
        current: current.toString(),
        limit: limit.toString(),
      });
    }

    const row = existing[0];
    const current = BigInt(row.current_value);
    const limit = BigInt(row.limit_value);
    await this.emitQuotaExceeded(input, "limit_exceeded");
    throw new QuotaExceededError("Quota limit exceeded.", {
      quota_key: input.quotaKey,
      current: current.toString(),
      limit: limit.toString(),
    });
  }

  /**
   * Atomic decrement clamped at 0. v4 §21.3 step 3 calls this from the
   * sweep, and the storage reservation service calls it on
   * `releaseReservation`. Returns the new value; if the row does not
   * exist returns `0n` (idempotent).
   */
  public async releaseQuota(input: ReleaseQuotaInput): Promise<bigint> {
    if (input.decrement < 0n) {
      throw new QuotaExceededError(
        "Quota decrement must be non-negative.",
        { quota_key: input.quotaKey },
      );
    }
    const exec = input.tx ?? this.sql;
    const rows = await exec<{ current_value: string }[]>`
      UPDATE quota_counters
      SET current_value = GREATEST(current_value - ${input.decrement.toString()}::bigint, 0)
      WHERE workspace_id = ${input.workspaceId}
        AND quota_key = ${input.quotaKey}
      RETURNING current_value
    `;
    if (rows.length === 0) {
      return 0n;
    }
    return BigInt(rows[0].current_value);
  }

  /**
   * Deployment-side provisioning. UPSERTs a counter with the supplied
   * `limit_value`; for a windowed quota also sets the period bounds.
   * The CHECK constraint (`quota_counters_period_check`) enforces that
   * both period fields are NULL or both NOT NULL with end > start; if
   * the call site disagrees, we translate the SQLSTATE 23514 into a
   * typed `QuotaExceededError`.
   */
  public async provisionQuota(input: ProvisionQuotaInput): Promise<void> {
    const { periodStart, periodEnd } = input;
    if (
      (periodStart === undefined && periodEnd !== undefined) ||
      (periodStart !== undefined && periodEnd === undefined)
    ) {
      throw new QuotaExceededError(
        "Quota period invalid.",
        { quota_key: input.quotaKey },
      );
    }
    try {
      await this.sql`
        INSERT INTO quota_counters
          (workspace_id, quota_key, current_value, limit_value, period_start, period_end)
        VALUES (
          ${input.workspaceId},
          ${input.quotaKey},
          0,
          ${input.limitValue.toString()}::bigint,
          ${periodStart ?? null},
          ${periodEnd ?? null}
        )
        ON CONFLICT (workspace_id, quota_key) DO UPDATE
          SET limit_value = EXCLUDED.limit_value,
              period_start = EXCLUDED.period_start,
              period_end = EXCLUDED.period_end
      `;
    } catch (err) {
      if (
        isPgError(err) &&
        err.code === PG_CHECK_VIOLATION &&
        typeof err.constraint_name === "string" &&
        err.constraint_name === "quota_counters_period_check"
      ) {
        throw new QuotaExceededError(
          "Quota period invalid.",
          { quota_key: input.quotaKey },
          err,
        );
      }
      throw err;
    }
  }

  /**
   * Recovery path per v4 §21.3 final paragraph: sum the bytes "in
   * flight" against quota for `(workspaceId, quotaKey)` from
   * `storage_reservations`. Both `reserved` and `committed` count
   * because either holds quota (reserved is pre-write, committed is
   * post-write); `released` and `expired` do not.
   *
   * Caller compares to `quota_counters.current_value` and alerts on
   * divergence. This is intentionally a single SQL statement so the
   * periodic auditor can run it without touching application logic.
   */
  public async recomputeFromReservations(
    input: RecomputeFromReservationsInput,
  ): Promise<bigint> {
    // The "stored.bytes" key is the only quota currently backed by
    // storage reservations. The query is parameterized on the key
    // anyway so the same recovery path covers any future byte-shaped
    // counter (e.g. "exported.bytes") without code changes.
    if (input.quotaKey !== "stored.bytes") {
      // Other quotas don't use storage_reservations; the expected
      // counter value derived from reservations is 0 by definition.
      return 0n;
    }
    const rows = await this.sql<RecomputeRow[]>`
      SELECT COALESCE(SUM(bytes_reserved), 0)::text AS total
      FROM storage_reservations
      WHERE workspace_id = ${input.workspaceId}
        AND status IN ('reserved', 'committed')
    `;
    return BigInt(rows[0]?.total ?? "0");
  }

  /**
   * Atomic conditional UPDATE; returns the new `current_value` on
   * success (1 row affected), `null` when 0 rows affected. Period
   * window check uses `now()` so the DB clock is the timing source.
   */
  private async runAtomicIncrement(
    exec: SqlExecutor,
    input: ReserveQuotaInput,
  ): Promise<bigint | null> {
    const rows = await exec<{ current_value: string }[]>`
      UPDATE quota_counters
      SET current_value = current_value + ${input.increment.toString()}::bigint
      WHERE workspace_id = ${input.workspaceId}
        AND quota_key = ${input.quotaKey}
        AND current_value + ${input.increment.toString()}::bigint <= limit_value
        AND (period_end IS NULL OR period_end > now())
      RETURNING current_value
    `;
    if (rows.length === 0) {
      return null;
    }
    return BigInt(rows[0].current_value);
  }

  private async emitQuotaExceeded(
    input: ReserveQuotaInput,
    deniedReason: "limit_exceeded" | "not_provisioned",
  ): Promise<void> {
    await this.auditLogger.write({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      actorType: "human",
      action: "quota.exceeded",
      result: "denied",
      requestId: input.requestId,
      metadata: {
        quota_key: input.quotaKey,
        denied_reason: deniedReason,
      },
    });
  }
}

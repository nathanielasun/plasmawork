/**
 * L3.5 — QuotaCounterService — Postgres-gated behavior tests.
 *
 * Pins the v4 §21.2 atomic-enforcement contract:
 *
 *   1. Atomic conditional UPDATE: the counter increments only when the
 *      WHERE clause matches; concurrent callers race on the row, never
 *      on application-side state.
 *   2. Audit emit BEFORE throw on every rejection path.
 *   3. Provisioned vs. unprovisioned discrimination (the spec leaves
 *      no comfortable default; we throw `Quota not configured.` unless
 *      a `defaultLimits` entry is configured).
 *   4. CHECK constraint on period bounds is translated into
 *      `QuotaExceededError("Quota period invalid.")`.
 *   5. `recomputeFromReservations` returns the SQL-side `reserved +
 *      committed` byte sum (the recovery-mode auditor query).
 *
 * Gated on `PLASMAWORK_TEST_DB_URL`; skipped cleanly when unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  HAS_TEST_DB,
  bindFactories,
  createScratchDb,
  resetTestDb,
  type ScratchDb,
} from "../fixtures/index.js";
import { AuditLogger, type PreparedAuditRow } from "../../src/audit/logger.js";
import { QuotaCounterService } from "../../src/quotas/counters.js";
import { QuotaExceededError } from "../../src/errors/shapes.js";

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

describe.skipIf(!HAS_TEST_DB)("L3.5 — QuotaCounterService", () => {
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

  it("increments under limit and persists the new value", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new QuotaCounterService({
      sql: db.sql,
      auditLogger: audit.logger,
    });
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);

    await svc.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
      limitValue: 1000n,
    });

    const result = await svc.reserveQuota({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
      increment: 250n,
      requestId: "req_under_limit",
      actorUserId: creator.id,
    });

    expect(result.ok).toBe(true);
    expect(result.newValue).toBe(250n);

    const rows = await db.sql<{ current_value: string }[]>`
      SELECT current_value FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'stored.bytes'
    `;
    expect(BigInt(rows[0].current_value)).toBe(250n);
    expect(audit.rows).toHaveLength(0); // success path emits no audit row.
  });

  it("rejects increments that would exceed the limit and emits quota.exceeded", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new QuotaCounterService({
      sql: db.sql,
      auditLogger: audit.logger,
    });
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);

    await svc.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "active.runs",
      limitValue: 5n,
    });
    await svc.reserveQuota({
      workspaceId: ws.id,
      quotaKey: "active.runs",
      increment: 4n,
      requestId: "req_warm",
      actorUserId: creator.id,
    });

    await expect(
      svc.reserveQuota({
        workspaceId: ws.id,
        quotaKey: "active.runs",
        increment: 2n,
        requestId: "req_overflow",
        actorUserId: creator.id,
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe("quota.exceeded");
    expect(audit.rows[0].result).toBe("denied");
    expect(audit.rows[0].metadata).toMatchObject({
      quota_key: "active.runs",
      denied_reason: "limit_exceeded",
    });

    // Counter must not have advanced.
    const rows = await db.sql<{ current_value: string }[]>`
      SELECT current_value FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'active.runs'
    `;
    expect(BigInt(rows[0].current_value)).toBe(4n);
  });

  it("under concurrency with limit=5 and 10 parallel +1 calls, exactly 5 succeed", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new QuotaCounterService({
      sql: db.sql,
      auditLogger: audit.logger,
    });
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await svc.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "concurrent.key",
      limitValue: 5n,
    });

    const attempts = Array.from({ length: 10 }, (_v, i) =>
      svc
        .reserveQuota({
          workspaceId: ws.id,
          quotaKey: "concurrent.key",
          increment: 1n,
          requestId: `req_conc_${i}`,
          actorUserId: creator.id,
        })
        .then(() => "ok" as const)
        .catch((err: unknown) =>
          err instanceof QuotaExceededError ? ("rejected" as const) : "other",
        ),
    );
    const outcomes = await Promise.all(attempts);
    const successes = outcomes.filter((o) => o === "ok").length;
    const rejections = outcomes.filter((o) => o === "rejected").length;
    expect(successes).toBe(5);
    expect(rejections).toBe(5);

    const rows = await db.sql<{ current_value: string }[]>`
      SELECT current_value FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'concurrent.key'
    `;
    expect(BigInt(rows[0].current_value)).toBe(5n);
  });

  it("throws Quota not configured. when the row is missing and no default is set", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new QuotaCounterService({
      sql: db.sql,
      auditLogger: audit.logger,
    });
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);

    await expect(
      svc.reserveQuota({
        workspaceId: ws.id,
        quotaKey: "unprovisioned.key",
        increment: 1n,
        requestId: "req_missing",
        actorUserId: creator.id,
      }),
    ).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      message: "Quota not configured.",
    });
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toMatchObject({
      denied_reason: "not_provisioned",
    });
    // Confirm no row was implicitly created.
    const rows = await db.sql`
      SELECT 1 FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'unprovisioned.key'
    `;
    expect(rows).toHaveLength(0);
  });

  it("releaseQuota decrements and clamps at zero", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new QuotaCounterService({
      sql: db.sql,
      auditLogger: audit.logger,
    });
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await svc.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "decrement.key",
      limitValue: 1000n,
    });
    await svc.reserveQuota({
      workspaceId: ws.id,
      quotaKey: "decrement.key",
      increment: 100n,
      requestId: "req_dec_set",
      actorUserId: creator.id,
    });

    const after = await svc.releaseQuota({
      workspaceId: ws.id,
      quotaKey: "decrement.key",
      decrement: 30n,
    });
    expect(after).toBe(70n);

    // Over-release clamps at 0 instead of going negative.
    const clamped = await svc.releaseQuota({
      workspaceId: ws.id,
      quotaKey: "decrement.key",
      decrement: 9999n,
    });
    expect(clamped).toBe(0n);
  });

  it("provisionQuota accepts cumulative AND period rows; rejects partial period", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new QuotaCounterService({
      sql: db.sql,
      auditLogger: audit.logger,
    });
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);

    // Cumulative: both NULL.
    await svc.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "cumulative.key",
      limitValue: 50n,
    });

    // Period: both set, end > start.
    const start = new Date("2026-05-01T00:00:00Z");
    const end = new Date("2026-05-02T00:00:00Z");
    await svc.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "period.key",
      limitValue: 10n,
      periodStart: start,
      periodEnd: end,
    });

    const rows = await db.sql<{
      quota_key: string;
      period_start: Date | null;
      period_end: Date | null;
    }[]>`
      SELECT quota_key, period_start, period_end
      FROM quota_counters
      WHERE workspace_id = ${ws.id}
    `;
    expect(rows).toHaveLength(2);

    // Partial period: API-level rejection (no DB hit).
    await expect(
      svc.provisionQuota({
        workspaceId: ws.id,
        quotaKey: "broken.key",
        limitValue: 1n,
        periodStart: start,
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });

    // Inverted period: DB CHECK constraint is the gate; API translates.
    await expect(
      svc.provisionQuota({
        workspaceId: ws.id,
        quotaKey: "inverted.key",
        limitValue: 1n,
        periodStart: end,
        periodEnd: start, // end <= start
      }),
    ).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      message: "Quota period invalid.",
    });
  });

  it("recomputeFromReservations sums reserved+committed bytes", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new QuotaCounterService({
      sql: db.sql,
      auditLogger: audit.logger,
    });
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await f.makeStorageReservation(ws, creator, 100n, { status: "reserved" });
    await f.makeStorageReservation(ws, creator, 200n, { status: "committed" });
    await f.makeStorageReservation(ws, creator, 400n, { status: "released" });
    await f.makeStorageReservation(ws, creator, 800n, { status: "expired" });

    const total = await svc.recomputeFromReservations({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
    });
    expect(total).toBe(300n);

    const otherKey = await svc.recomputeFromReservations({
      workspaceId: ws.id,
      quotaKey: "active.runs",
    });
    expect(otherKey).toBe(0n);
  });
});

/**
 * L3.5 — StorageReservationService — Postgres-gated behavior tests.
 *
 * Pins the v4 §21.3 lifecycle:
 *   - reserve: counter+row written atomically; failure rolls both back
 *   - commit:  status flip only; counter unchanged
 *   - release: status flip + counter decrement; idempotent
 *   - expire:  periodic sweep marks overdue rows expired, decrements
 *              the counter, emits one audit row per expiry
 *
 * Concurrency: a reservation can never be both 'expired' AND
 * 'committed'; whichever statement updates the row first wins, the
 * other sees 0 rows affected.
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
import { StorageReservationService } from "../../src/quotas/storageReservations.js";
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

interface Stack {
  audit: AuditHarness;
  counters: QuotaCounterService;
  reservations: StorageReservationService;
}

function makeStack(db: ScratchDb): Stack {
  const audit = makeAuditHarness();
  const counters = new QuotaCounterService({
    sql: db.sql,
    auditLogger: audit.logger,
  });
  const reservations = new StorageReservationService({
    sql: db.sql,
    auditLogger: audit.logger,
    counterService: counters,
  });
  return { audit, counters, reservations };
}

describe.skipIf(!HAS_TEST_DB)("L3.5 — StorageReservationService", () => {
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

  it("reserveBytes: counter += bytes and a 'reserved' row is created", async () => {
    const f = bindFactories(db.sql);
    const stack = makeStack(db);
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await stack.counters.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
      limitValue: 10_000n,
    });

    const r = await stack.reservations.reserveBytes({
      workspaceId: ws.id,
      requestedBy: creator.id,
      bytes: 1234n,
      requestId: "req_reserve_1",
    });
    expect(r.reservationId).toMatch(/-/);
    expect(r.expiresAt).toBeInstanceOf(Date);

    const counter = await db.sql<{ current_value: string }[]>`
      SELECT current_value FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'stored.bytes'
    `;
    expect(BigInt(counter[0].current_value)).toBe(1234n);

    const reservation = await db.sql<{ status: string; bytes_reserved: string }[]>`
      SELECT status, bytes_reserved FROM storage_reservations
      WHERE id = ${r.reservationId}
    `;
    expect(reservation[0].status).toBe("reserved");
    expect(BigInt(reservation[0].bytes_reserved)).toBe(1234n);
  });

  it("reserveBytes: when over-limit, no reservation row is created (tx rollback)", async () => {
    const f = bindFactories(db.sql);
    const stack = makeStack(db);
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await stack.counters.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
      limitValue: 100n,
    });

    const before = await db.sql`SELECT id FROM storage_reservations`;
    expect(before).toHaveLength(0);

    await expect(
      stack.reservations.reserveBytes({
        workspaceId: ws.id,
        requestedBy: creator.id,
        bytes: 200n,
        requestId: "req_too_big",
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);

    const after = await db.sql`SELECT id FROM storage_reservations`;
    expect(after).toHaveLength(0);

    // Counter must remain at zero (the conditional UPDATE never fired).
    const counter = await db.sql<{ current_value: string }[]>`
      SELECT current_value FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'stored.bytes'
    `;
    expect(BigInt(counter[0].current_value)).toBe(0n);
  });

  it("commitReservation flips status without touching counter", async () => {
    const f = bindFactories(db.sql);
    const stack = makeStack(db);
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await stack.counters.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
      limitValue: 1_000n,
    });
    const r = await stack.reservations.reserveBytes({
      workspaceId: ws.id,
      requestedBy: creator.id,
      bytes: 500n,
      requestId: "req_cmt_setup",
    });

    await stack.reservations.commitReservation({
      reservationId: r.reservationId,
      workspaceId: ws.id,
      requestId: "req_cmt_do",
    });

    const row = await db.sql<{ status: string }[]>`
      SELECT status FROM storage_reservations WHERE id = ${r.reservationId}
    `;
    expect(row[0].status).toBe("committed");

    const counter = await db.sql<{ current_value: string }[]>`
      SELECT current_value FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'stored.bytes'
    `;
    expect(BigInt(counter[0].current_value)).toBe(500n);

    // Committing twice is a programming error.
    await expect(
      stack.reservations.commitReservation({
        reservationId: r.reservationId,
        workspaceId: ws.id,
        requestId: "req_cmt_again",
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it("releaseReservation flips status and returns bytes to the counter", async () => {
    const f = bindFactories(db.sql);
    const stack = makeStack(db);
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await stack.counters.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
      limitValue: 1_000n,
    });
    const r = await stack.reservations.reserveBytes({
      workspaceId: ws.id,
      requestedBy: creator.id,
      bytes: 750n,
      requestId: "req_rel_setup",
    });

    await stack.reservations.releaseReservation({
      reservationId: r.reservationId,
      workspaceId: ws.id,
      requestId: "req_rel_do",
    });

    const row = await db.sql<{ status: string }[]>`
      SELECT status FROM storage_reservations WHERE id = ${r.reservationId}
    `;
    expect(row[0].status).toBe("released");

    const counter = await db.sql<{ current_value: string }[]>`
      SELECT current_value FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'stored.bytes'
    `;
    expect(BigInt(counter[0].current_value)).toBe(0n);

    // Idempotent: a second release is a no-op (counter doesn't go negative).
    await stack.reservations.releaseReservation({
      reservationId: r.reservationId,
      workspaceId: ws.id,
      requestId: "req_rel_again",
    });
    const counterAgain = await db.sql<{ current_value: string }[]>`
      SELECT current_value FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'stored.bytes'
    `;
    expect(BigInt(counterAgain[0].current_value)).toBe(0n);
  });

  it("expireOverdueReservations expires past-due rows, decrements counter, emits audit", async () => {
    const f = bindFactories(db.sql);
    const stack = makeStack(db);
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await stack.counters.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
      limitValue: 10_000n,
    });

    // Three rows already past expiry. The counter must reflect them
    // before the sweep so we can watch the decrement happen.
    const past = new Date(Date.now() - 60_000);
    const r1 = await f.makeStorageReservation(ws, creator, 100n, {
      status: "reserved",
      expires_at: past,
    });
    const r2 = await f.makeStorageReservation(ws, creator, 200n, {
      status: "reserved",
      expires_at: past,
    });
    const r3 = await f.makeStorageReservation(ws, creator, 50n, {
      status: "reserved",
      expires_at: past,
    });
    await db.sql`
      UPDATE quota_counters
      SET current_value = 350
      WHERE workspace_id = ${ws.id} AND quota_key = 'stored.bytes'
    `;

    const before = stack.audit.rows.length;
    const result = await stack.reservations.expireOverdueReservations({
      requestId: "req_sweep_1",
    });
    expect(result.expiredIds).toHaveLength(3);
    expect(result.expiredIds).toEqual(
      expect.arrayContaining([r1.id, r2.id, r3.id]),
    );
    expect(result.bytesReturned).toBe(350n);

    const counter = await db.sql<{ current_value: string }[]>`
      SELECT current_value FROM quota_counters
      WHERE workspace_id = ${ws.id} AND quota_key = 'stored.bytes'
    `;
    expect(BigInt(counter[0].current_value)).toBe(0n);

    const auditEmitted = stack.audit.rows.slice(before);
    expect(auditEmitted).toHaveLength(3);
    for (const row of auditEmitted) {
      expect(row.action).toBe("quota.reservation_expired");
      expect(row.actor_type).toBe("unauthenticated");
      expect(row.actor_user_id).toBeNull();
      expect(row.metadata).toMatchObject({ quota_key: "stored.bytes" });
      expect(typeof (row.metadata as { bytes_reserved?: unknown }).bytes_reserved)
        .toBe("string");
    }
  });

  it("expireOverdueReservations does NOT touch committed rows or future expiries", async () => {
    const f = bindFactories(db.sql);
    const stack = makeStack(db);
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await stack.counters.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
      limitValue: 10_000n,
    });

    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const committed = await f.makeStorageReservation(ws, creator, 100n, {
      status: "committed",
      expires_at: past,
    });
    const stillReserved = await f.makeStorageReservation(ws, creator, 50n, {
      status: "reserved",
      expires_at: future,
    });

    const result = await stack.reservations.expireOverdueReservations({
      requestId: "req_sweep_negatives",
    });
    expect(result.expiredIds).toHaveLength(0);
    expect(result.bytesReturned).toBe(0n);

    const status = await db.sql<{ id: string; status: string }[]>`
      SELECT id, status FROM storage_reservations
      WHERE id IN (${committed.id}, ${stillReserved.id})
      ORDER BY id
    `;
    const map = new Map(status.map((r) => [r.id, r.status]));
    expect(map.get(committed.id)).toBe("committed");
    expect(map.get(stillReserved.id)).toBe("reserved");
  });

  it("commitReservation racing the sweep: a row is never both expired AND committed", async () => {
    const f = bindFactories(db.sql);
    const stack = makeStack(db);
    const creator = await f.makeUser();
    const ws = await f.makeWorkspace(creator);
    await stack.counters.provisionQuota({
      workspaceId: ws.id,
      quotaKey: "stored.bytes",
      limitValue: 10_000n,
    });

    const past = new Date(Date.now() - 60_000);
    const r = await f.makeStorageReservation(ws, creator, 100n, {
      status: "reserved",
      expires_at: past,
    });
    await db.sql`
      UPDATE quota_counters
      SET current_value = 100
      WHERE workspace_id = ${ws.id} AND quota_key = 'stored.bytes'
    `;

    const sweep = stack.reservations.expireOverdueReservations({
      requestId: "req_race_sweep",
    });
    const commit = stack.reservations
      .commitReservation({
        reservationId: r.id,
        workspaceId: ws.id,
        requestId: "req_race_commit",
      })
      .then(() => "committed" as const)
      .catch(() => "rejected" as const);

    const [sweepResult, commitOutcome] = await Promise.all([sweep, commit]);

    const status = await db.sql<{ status: string }[]>`
      SELECT status FROM storage_reservations WHERE id = ${r.id}
    `;
    // Whichever path won the row, the final status is one (and only one)
    // of the two terminal states. Never both.
    const finalStatus = status[0].status;
    expect(["expired", "committed"]).toContain(finalStatus);

    if (finalStatus === "expired") {
      expect(sweepResult.expiredIds).toContain(r.id);
      expect(commitOutcome).toBe("rejected");
    } else {
      expect(sweepResult.expiredIds).not.toContain(r.id);
      expect(commitOutcome).toBe("committed");
    }
  });
});

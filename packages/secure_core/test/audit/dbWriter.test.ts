/**
 * L3.1 audit DB writer — Postgres-backed behavior tests.
 *
 * Pins:
 *   1. `AuditDbWriter` writes a single row to `audit_events` per call;
 *      a SELECT immediately afterward sees the row with byte-equal
 *      `prev_hash` / `row_hash` to what the logger emitted.
 *   2. `prevHashGetter` returns `null` on an empty table and the most
 *      recently committed `row_hash` afterward.
 *   3. The writer is `logType`-scoped: an `audit` writer's
 *      prevHashGetter does not see provenance rows, and vice versa.
 *   4. The full `AuditLogger` + `AuditDbWriter` pipeline writes 5 rows
 *      to `audit_events` whose chain advances correctly.
 *
 * Gated on `PLASMAWORK_TEST_DB_URL`. When unset, the suite reports
 * skipped with the standard message.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  AuditLogger,
  AuditDbWriter,
  type PreparedAuditRow,
  type PreparedProvenanceRow,
} from "../../src/audit/index.js";
import { CANONICALIZATION_VERSION } from "../../src/crypto/jcs.js";
import * as schema from "../../src/db/schema.js";
import type { SecureCorePool } from "../../src/db/pool.js";

import {
  HAS_TEST_DB,
  TEST_DB_SKIP_REASON,
  bindFactories,
  createScratchDb,
  resetTestDb,
  type ScratchDb,
} from "../fixtures/index.js";

function poolFromScratch(db: ScratchDb): SecureCorePool {
  // A SecureCorePool wired to the scratch DB's migrator-role client.
  // Tests use the migrator role because it owns every table and
  // bypasses the per-role GRANT restrictions; the L3.1 surface itself
  // does not depend on the role beyond what the SQL it issues
  // requires.
  const drizzleDb = drizzle(db.sql, { schema });
  return {
    role: "migrator",
    sql: db.sql,
    db: drizzleDb,
    async close() {
      // The scratch db owns the underlying client lifecycle; this pool
      // is a non-owning view, so close() is a no-op.
    },
  };
}

describe.skipIf(!HAS_TEST_DB)("L3.1 — AuditDbWriter (audit_events)", () => {
  let db: ScratchDb;
  let pool: SecureCorePool;

  beforeAll(async () => {
    db = await createScratchDb();
    pool = poolFromScratch(db);
  }, 60_000);

  afterAll(async () => {
    await db?.cleanup();
  }, 30_000);

  beforeEach(async () => {
    await resetTestDb(db.sql);
  });

  it("writes one row per logger call and chains correctly", async () => {
    const f = bindFactories(db.sql);
    const creator = await f.makeUser({ email: "writer-1@example.test" });
    const ws = await f.makeWorkspace(creator);

    const writer = new AuditDbWriter({ pool, logType: "audit" });
    const logger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });

    const emitted: PreparedAuditRow[] = [];
    for (let i = 0; i < 5; i += 1) {
      const row = await logger.write({
        workspaceId: ws.id,
        actorUserId: creator.id,
        actorType: "human",
        action: "capsule.created",
        objectType: "capsule",
        objectId: "00000000-0000-4000-8000-00000000000a",
        result: "succeeded",
        requestId: `req_${i}`,
        ipHmac: "ip-hmac",
        userAgentHmac: "ua-hmac",
        metadata: { version_id: `v${i}` },
      });
      emitted.push(row);
    }

    // Chain advance: prev_hash[i] === row_hash[i-1], first is null.
    expect(emitted[0].prev_hash).toBeNull();
    for (let i = 1; i < emitted.length; i += 1) {
      expect(emitted[i].prev_hash).toBe(emitted[i - 1].row_hash);
    }

    const stored = await db.sql<
      {
        id: string;
        prev_hash: string | null;
        row_hash: string;
        canonicalization_version: string;
        action: string;
      }[]
    >`SELECT id, prev_hash, row_hash, canonicalization_version, action
        FROM audit_events ORDER BY created_at ASC, id ASC`;
    expect(stored.length).toBe(5);
    for (let i = 0; i < 5; i += 1) {
      expect(stored[i].id).toBe(emitted[i].id);
      expect(stored[i].prev_hash).toBe(emitted[i].prev_hash);
      expect(stored[i].row_hash).toBe(emitted[i].row_hash);
      expect(stored[i].canonicalization_version).toBe(CANONICALIZATION_VERSION);
      expect(stored[i].action).toBe("capsule.created");
    }
  });

  it("prevHashGetter returns null on empty, latest tip after writes", async () => {
    const f = bindFactories(db.sql);
    const creator = await f.makeUser({ email: "writer-2@example.test" });
    const ws = await f.makeWorkspace(creator);

    const writer = new AuditDbWriter({ pool, logType: "audit" });
    expect(await writer.prevHashGetter()).toBeNull();

    const logger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });
    const row = await logger.write({
      workspaceId: ws.id,
      actorUserId: creator.id,
      actorType: "human",
      action: "capsule.created",
      objectType: "capsule",
      objectId: "00000000-0000-4000-8000-00000000000b",
      result: "succeeded",
      requestId: "req_only",
      metadata: { version_id: "v1" },
    });

    const tip = await writer.prevHashGetter();
    expect(tip).toBe(row.row_hash);
  });

  it("audit-scoped getter does not see provenance rows", async () => {
    const f = bindFactories(db.sql);
    const creator = await f.makeUser({ email: "writer-3@example.test" });
    const ws = await f.makeWorkspace(creator);

    // Manually insert a provenance row (no logger for this table yet).
    const auditWriter = new AuditDbWriter({ pool, logType: "audit" });
    const provWriter = new AuditDbWriter({ pool, logType: "provenance" });

    const provRow: PreparedProvenanceRow = {
      id: "00000000-0000-4000-8000-00000000aaaa",
      workspace_id: ws.id,
      actor_user_id: creator.id,
      actor_type: "human",
      capsule_id: null,
      run_id: null,
      action: "capsule.created",
      object_type: "capsule",
      object_id: "00000000-0000-4000-8000-00000000bbbb",
      metadata: {},
      created_at: new Date().toISOString(),
      prev_hash: null,
      row_hash:
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      canonicalization_version: CANONICALIZATION_VERSION,
    };
    await provWriter.writer(provRow);

    // The audit writer's getter must still see an empty audit chain.
    expect(await auditWriter.prevHashGetter()).toBeNull();
    // The provenance writer's getter must see the inserted row.
    expect(await provWriter.prevHashGetter()).toBe(provRow.row_hash);
  });
});

describe.runIf(!HAS_TEST_DB)(
  "L3.1 — AuditDbWriter tests skipped (no PLASMAWORK_TEST_DB_URL)",
  () => {
    it("skipped because PLASMAWORK_TEST_DB_URL is not set", () => {
      expect(TEST_DB_SKIP_REASON).toMatch(/PLASMAWORK_TEST_DB_URL/);
    });
  },
);

// Silence the `postgres` import being unused if a future refactor drops
// the type annotation. Keeping the explicit re-import makes the
// "scratch sql is the postgres-js client" contract explicit.
void postgres;

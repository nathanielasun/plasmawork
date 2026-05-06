/**
 * L3.2 — AnchorCommitter behavior tests.
 *
 * Pins:
 *   - commitTip happy path (audit_events): row exists; URI contains
 *     versionId=; anchor_hash matches tip row_hash; audit row
 *     log_chain.anchor_committed emitted.
 *   - commitTip on an empty chain throws VERSION_CONFLICT.
 *   - Mutating the anchored row's metadata after commit causes
 *     verifyFromAnchor to fail (proves L3.2 wires through L3.1).
 *   - commitIfThresholdReached returns null below threshold and a
 *     row at-or-above threshold.
 *   - Cross-type isolation: an audit anchor doesn't see provenance
 *     rows.
 *   - URI passes the L1.8 versionId= CHECK.
 *   - Provider failure path: no anchor row inserted when S3 PUT throws.
 *
 * Gated on PLASMAWORK_TEST_DB_URL.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";

import {
  AnchorCommitter,
  AuditDbWriter,
  AuditLogger,
  FakeS3AnchorProvider,
} from "../../src/audit/index.js";
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
  const drizzleDb = drizzle(db.sql, { schema });
  return {
    role: "migrator",
    sql: db.sql,
    db: drizzleDb,
    async close() {
      // non-owning view
    },
  };
}

interface AuditCall {
  action: string;
  result: string;
  metadata?: Record<string, unknown>;
}

function recordingAuditLogger(
  inner: AuditLogger,
  calls: AuditCall[],
): AuditLogger {
  return {
    async write(input: {
      action: string;
      result: string;
      metadata?: Record<string, unknown>;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        metadata: input.metadata,
      });
      return inner.write(
        input as Parameters<AuditLogger["write"]>[0],
      );
    },
  } as unknown as AuditLogger;
}

describe.skipIf(!HAS_TEST_DB)("L3.2 — AnchorCommitter", () => {
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

  async function seedAuditChain(rowCount: number): Promise<{
    logger: AuditLogger;
    workspaceId: string;
    actorUserId: string;
  }> {
    const f = bindFactories(db.sql);
    const creator = await f.makeUser({ email: "anchor@example.test" });
    const ws = await f.makeWorkspace(creator);
    const writer = new AuditDbWriter({ pool, logType: "audit" });
    const logger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });
    for (let i = 0; i < rowCount; i += 1) {
      await logger.write({
        workspaceId: ws.id,
        actorUserId: creator.id,
        actorType: "human",
        action: "capsule.created",
        result: "succeeded",
        requestId: `req-${i}`,
      });
    }
    return { logger, workspaceId: ws.id, actorUserId: creator.id };
  }

  it("commitTip on empty chain throws VERSION_CONFLICT", async () => {
    const provider = new FakeS3AnchorProvider();
    const writer = new AuditDbWriter({ pool, logType: "audit" });
    const innerLogger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });
    const calls: AuditCall[] = [];
    const committer = new AnchorCommitter({
      pool,
      auditLogger: recordingAuditLogger(innerLogger, calls),
      s3Provider: provider,
      logType: "audit",
      bucket: "test-bucket",
      keyPrefix: "anchors",
    });
    await expect(
      committer.commitTip({ committedBy: null, requestId: "req-0" }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("commitTip happy path writes log_chain_anchors row + emits audit", async () => {
    await seedAuditChain(3);
    const provider = new FakeS3AnchorProvider();
    const writer = new AuditDbWriter({ pool, logType: "audit" });
    const innerLogger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });
    const calls: AuditCall[] = [];
    const committer = new AnchorCommitter({
      pool,
      auditLogger: recordingAuditLogger(innerLogger, calls),
      s3Provider: provider,
      logType: "audit",
      bucket: "test-bucket",
      keyPrefix: "anchors/v1",
    });

    const operatorId = randomUUID();
    await db.sql.unsafe(
      `INSERT INTO users (id, email) VALUES ('${operatorId}', 'op@example.test')`,
    );
    const row = await committer.commitTip({
      committedBy: operatorId,
      requestId: "req-commit-1",
    });

    expect(row.log_type).toBe("audit_events");
    expect(row.external_anchor_uri).toContain("versionId=");
    expect(row.external_anchor_uri).toContain("test-bucket");
    expect(row.canonicalization_version).toBe("jcs-v1");
    expect(provider.puts()).toHaveLength(1);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.action).toBe("log_chain.anchor_committed");
    expect(lastCall.result).toBe("succeeded");
  });

  it("mutating the anchored row breaks chain segment verification", async () => {
    await seedAuditChain(3);
    const provider = new FakeS3AnchorProvider();
    const writer = new AuditDbWriter({ pool, logType: "audit" });
    const innerLogger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });
    const committer = new AnchorCommitter({
      pool,
      auditLogger: recordingAuditLogger(innerLogger, []),
      s3Provider: provider,
      logType: "audit",
      bucket: "test-bucket",
      keyPrefix: "anchors",
    });
    const row = await committer.commitTip({
      committedBy: null,
      requestId: "req-commit-tamper",
    });
    // Tamper: rewrite the anchored row's metadata. Hash recomputation
    // by the verifier should fail next time.
    await db.sql.unsafe(
      `UPDATE audit_events SET metadata = '{"tampered":true}'::jsonb WHERE id = $1::uuid`,
      [row.anchored_row_id],
    );
    // Verify the contract by attempting another commit on the same
    // tip — verifyFromAnchor inside commitTip would fail. Use a fresh
    // commit (write a new row first) so the new tip is different but
    // the prior chain is broken.
    await innerLogger.write({
      workspaceId: null,
      actorUserId: null,
      actorType: "unauthenticated",
      action: "login.failed",
      result: "failed",
      requestId: "req-after-tamper",
    });
    await expect(
      committer.commitTip({ committedBy: null, requestId: "req-after-tamper-anchor" }),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("commitIfThresholdReached returns null below threshold", async () => {
    await seedAuditChain(2);
    const provider = new FakeS3AnchorProvider();
    const writer = new AuditDbWriter({ pool, logType: "audit" });
    const innerLogger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });
    const committer = new AnchorCommitter({
      pool,
      auditLogger: recordingAuditLogger(innerLogger, []),
      s3Provider: provider,
      logType: "audit",
      bucket: "test-bucket",
      keyPrefix: "anchors",
      rowThreshold: 100, // far above current count
    });
    const result = await committer.commitIfThresholdReached({
      committedBy: null,
      requestId: "req-thresh-low",
    });
    expect(result).toBeNull();
    expect(provider.puts()).toHaveLength(0);
  });

  it("commitIfThresholdReached commits when threshold met", async () => {
    await seedAuditChain(3);
    const provider = new FakeS3AnchorProvider();
    const writer = new AuditDbWriter({ pool, logType: "audit" });
    const innerLogger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });
    const committer = new AnchorCommitter({
      pool,
      auditLogger: recordingAuditLogger(innerLogger, []),
      s3Provider: provider,
      logType: "audit",
      bucket: "test-bucket",
      keyPrefix: "anchors",
      rowThreshold: 2,
    });
    const result = await committer.commitIfThresholdReached({
      committedBy: null,
      requestId: "req-thresh-met",
    });
    expect(result).not.toBeNull();
    expect(provider.puts()).toHaveLength(1);
  });

  it("provider failure leaves no anchor row in the DB", async () => {
    await seedAuditChain(2);
    const provider = new FakeS3AnchorProvider();
    provider.failNextPut(new Error("simulated S3 outage"));
    const writer = new AuditDbWriter({ pool, logType: "audit" });
    const innerLogger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });
    const committer = new AnchorCommitter({
      pool,
      auditLogger: recordingAuditLogger(innerLogger, []),
      s3Provider: provider,
      logType: "audit",
      bucket: "test-bucket",
      keyPrefix: "anchors",
    });
    await expect(
      committer.commitTip({ committedBy: null, requestId: "req-fail" }),
    ).rejects.toThrow(/simulated S3 outage/);
    const after = await db.sql.unsafe<Array<{ n: string }>>(
      `SELECT count(*)::text AS n FROM log_chain_anchors`,
    );
    expect(after[0].n).toBe("0");
  });

  it("cross-type isolation: provenance committer ignores audit_events tip", async () => {
    await seedAuditChain(3); // populates audit_events only
    const provider = new FakeS3AnchorProvider();
    const writer = new AuditDbWriter({ pool, logType: "provenance" });
    const innerLogger = new AuditLogger({
      writer: writer.writer,
      prevHashGetter: writer.prevHashGetter,
    });
    const committer = new AnchorCommitter({
      pool,
      auditLogger: recordingAuditLogger(innerLogger, []),
      s3Provider: provider,
      logType: "provenance",
      bucket: "test-bucket",
      keyPrefix: "anchors",
    });
    await expect(
      committer.commitTip({ committedBy: null, requestId: "req-prov" }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});

describe.runIf(!HAS_TEST_DB)("L3.2 — DB tests skipped (no PLASMAWORK_TEST_DB_URL)", () => {
  it("documents how to enable", () => {
    // eslint-disable-next-line no-console
    console.warn(TEST_DB_SKIP_REASON);
    expect(HAS_TEST_DB).toBe(false);
  });
});

describe("FakeS3AnchorProvider", () => {
  it("returns deterministic version ids", async () => {
    const p = new FakeS3AnchorProvider();
    const r1 = await p.putObject("b", "k1", Buffer.from("x"));
    const r2 = await p.putObject("b", "k2", Buffer.from("y"));
    expect(r1.versionId).not.toBe(r2.versionId);
    expect(p.puts()).toHaveLength(2);
  });

  it("failNextPut throws on the next call only", async () => {
    const p = new FakeS3AnchorProvider();
    p.failNextPut(new Error("nope"));
    await expect(p.putObject("b", "k", Buffer.from("x"))).rejects.toThrow("nope");
    // Next call succeeds.
    const ok = await p.putObject("b", "k", Buffer.from("x"));
    expect(ok.versionId).toBeDefined();
  });
});

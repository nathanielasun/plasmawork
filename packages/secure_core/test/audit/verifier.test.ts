/**
 * L3.1 chain verifier — Postgres-backed behavior tests.
 *
 * Pins:
 *   1. Happy path: 5 audit rows written via `AuditLogger` +
 *      `AuditDbWriter` verify cleanly with `rowsVerified === 5` and the
 *      tip hash matching the last row's `row_hash`.
 *   2. Hash mismatch: hand-mutating a row's `metadata` via raw SQL
 *      makes the verifier report `firstFailureRowId` of the mutated
 *      row with `failureReason: "hash_mismatch"`.
 *   3. Tail truncation: an anchor in `log_chain_anchors` that points
 *      at a row no longer present in the local DB makes the verifier
 *      report `tail_truncation`.
 *   4. Cross-type isolation: an `audit`-scoped verifier never walks
 *      `provenance_events`, and vice versa.
 *   5. All three log types verify independently in the same DB.
 *
 * Gated on `PLASMAWORK_TEST_DB_URL`. When unset, the suite reports
 * skipped with the standard message.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";

import {
  AuditChainVerifier,
  AuditLogger,
  AuditDbWriter,
  type PreparedOperatorRow,
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
  const drizzleDb = drizzle(db.sql, { schema });
  return {
    role: "migrator",
    sql: db.sql,
    db: drizzleDb,
    async close() {
      // non-owning view; cleanup belongs to the scratch DB.
    },
  };
}

interface AuditFixtureCtx {
  workspaceId: string;
  actorUserId: string;
}

async function writeNAuditRows(
  pool: SecureCorePool,
  ctx: AuditFixtureCtx,
  n: number,
): Promise<{ ids: string[]; tip: string }> {
  const writer = new AuditDbWriter({ pool, logType: "audit" });
  const logger = new AuditLogger({
    writer: writer.writer,
    prevHashGetter: writer.prevHashGetter,
  });
  const ids: string[] = [];
  let tip = "";
  for (let i = 0; i < n; i += 1) {
    const row = await logger.write({
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.actorUserId,
      actorType: "human",
      action: "capsule.created",
      objectType: "capsule",
      objectId: "00000000-0000-4000-8000-0000000000aa",
      result: "succeeded",
      requestId: `req_${i}`,
      metadata: { version_id: `v${i}` },
    });
    ids.push(row.id);
    tip = row.row_hash;
  }
  return { ids, tip };
}

describe.skipIf(!HAS_TEST_DB)(
  "L3.1 — AuditChainVerifier (audit_events)",
  () => {
    let db: ScratchDb;
    let pool: SecureCorePool;
    let actor: string;
    let workspace: string;

    beforeAll(async () => {
      db = await createScratchDb();
      pool = poolFromScratch(db);
    }, 60_000);

    afterAll(async () => {
      await db?.cleanup();
    }, 30_000);

    beforeEach(async () => {
      await resetTestDb(db.sql);
      const f = bindFactories(db.sql);
      const creator = await f.makeUser({ email: "verifier@example.test" });
      const ws = await f.makeWorkspace(creator);
      actor = creator.id;
      workspace = ws.id;
    });

    it("verifies a clean 5-row chain end-to-end", async () => {
      const { tip } = await writeNAuditRows(
        pool,
        { workspaceId: workspace, actorUserId: actor },
        5,
      );
      const verifier = new AuditChainVerifier({ pool, logType: "audit" });
      const report = await verifier.verifyAll();
      expect(report.ok).toBe(true);
      if (report.ok) {
        expect(report.rowsVerified).toBe(5);
        expect(report.tipHash).toBe(tip);
      }
    });

    it("reports hash_mismatch when a row's metadata is mutated", async () => {
      const { ids } = await writeNAuditRows(
        pool,
        { workspaceId: workspace, actorUserId: actor },
        5,
      );

      // Mutate row 3's metadata via raw SQL (bypasses the logger and
      // every other gate). row_hash stays untouched, so recomputation
      // must disagree.
      const target = ids[2];
      await db.sql`
        UPDATE audit_events
        SET metadata = ${db.sql.json({ version_id: "tampered" })}
        WHERE id = ${target}
      `;

      const verifier = new AuditChainVerifier({ pool, logType: "audit" });
      const report = await verifier.verifyAll();
      expect(report.ok).toBe(false);
      if (!report.ok) {
        expect(report.firstFailureRowId).toBe(target);
        expect(report.failureReason).toBe("hash_mismatch");
      }
    });

    it("reports tail_truncation when an anchor points at a deleted row", async () => {
      const { ids } = await writeNAuditRows(
        pool,
        { workspaceId: workspace, actorUserId: actor },
        5,
      );

      // Read row 4's row_hash (this becomes the anchor's anchor_hash).
      const row4 = ids[3];
      const row4HashRows = await db.sql<{ row_hash: string }[]>`
        SELECT row_hash FROM audit_events WHERE id = ${row4}
      `;
      const row4Hash = row4HashRows[0].row_hash;

      // Insert an anchor referencing row 4. The external anchor URI
      // CHECK constraint (v4 §12) requires `versionId=` in the URI.
      const anchorId = randomUUID();
      await db.sql`
        INSERT INTO log_chain_anchors (
          id, log_type, anchor_hash, anchored_row_id,
          external_anchor_uri, canonicalization_version
        ) VALUES (
          ${anchorId},
          'audit_events',
          ${row4Hash},
          ${row4},
          's3://anchors/audit/abc?versionId=xyz',
          ${CANONICALIZATION_VERSION}
        )
      `;

      // Now delete row 5 — the anchor still expects row 4 with the
      // recorded hash, which IS still present, so this alone should
      // verify cleanly. Truncation only fires when the anchored row
      // itself goes missing or its hash changes. Verify that pre-
      // condition first.
      await db.sql`DELETE FROM audit_events WHERE id = ${ids[4]}`;
      const stillOk = await new AuditChainVerifier({
        pool,
        logType: "audit",
      }).verifyAll();
      expect(stillOk.ok).toBe(true);

      // Now delete row 4 — the anchored row is gone; truncation must
      // fire.
      await db.sql`DELETE FROM audit_events WHERE id = ${row4}`;
      const verifier = new AuditChainVerifier({ pool, logType: "audit" });
      const report = await verifier.verifyAll();
      expect(report.ok).toBe(false);
      if (!report.ok) {
        expect(report.firstFailureRowId).toBe(row4);
        expect(report.failureReason).toBe("tail_truncation");
      }
    });

    it("audit verifier does not walk provenance_events", async () => {
      // Write a clean audit chain.
      const { tip } = await writeNAuditRows(
        pool,
        { workspaceId: workspace, actorUserId: actor },
        3,
      );

      // Insert a provenance row whose row_hash is a known-bad value.
      // If the audit verifier wrongly walked provenance_events it
      // would fail on hash mismatch.
      const provWriter = new AuditDbWriter({ pool, logType: "provenance" });
      const corrupt: PreparedProvenanceRow = {
        id: "00000000-0000-4000-8000-00000000cccc",
        workspace_id: workspace,
        actor_user_id: actor,
        actor_type: "human",
        capsule_id: null,
        run_id: null,
        action: "capsule.created",
        object_type: "capsule",
        object_id: "00000000-0000-4000-8000-00000000dddd",
        metadata: {},
        created_at: new Date().toISOString(),
        prev_hash: null,
        // Deliberately wrong: the verifier-on-provenance MUST refuse
        // this; the verifier-on-audit MUST not see it.
        row_hash:
          "00000000000000000000000000000000000000000000000000000000deadbeef",
        canonicalization_version: CANONICALIZATION_VERSION,
      };
      await provWriter.writer(corrupt);

      const auditVerifier = new AuditChainVerifier({
        pool,
        logType: "audit",
      });
      const auditReport = await auditVerifier.verifyAll();
      expect(auditReport.ok).toBe(true);
      if (auditReport.ok) {
        expect(auditReport.rowsVerified).toBe(3);
        expect(auditReport.tipHash).toBe(tip);
      }

      const provVerifier = new AuditChainVerifier({
        pool,
        logType: "provenance",
      });
      const provReport = await provVerifier.verifyAll();
      expect(provReport.ok).toBe(false);
      if (!provReport.ok) {
        expect(provReport.firstFailureRowId).toBe(corrupt.id);
        expect(provReport.failureReason).toBe("hash_mismatch");
      }
    });

    it("verifies all three log types independently in the same DB", async () => {
      // Audit chain: 2 rows via the logger.
      const { tip: auditTip } = await writeNAuditRows(
        pool,
        { workspaceId: workspace, actorUserId: actor },
        2,
      );

      // Provenance chain: build by hand using the same hash math the
      // logger uses.
      const provWriter = new AuditDbWriter({ pool, logType: "provenance" });
      const { createHash } = await import("node:crypto");
      const { canonicalize } = await import("../../src/crypto/jcs.js");

      function provHash(args: {
        prevHash: string | null;
        canonicalFields: Record<string, unknown>;
      }): string {
        const payload = {
          prev_hash: args.prevHash,
          ...args.canonicalFields,
          canonicalization_version: CANONICALIZATION_VERSION,
        };
        return createHash("sha256")
          .update(canonicalize(payload), "utf8")
          .digest("hex");
      }

      const provIds = [randomUUID(), randomUUID()];
      let provPrev: string | null = null;
      let provTip = "";
      for (let i = 0; i < 2; i += 1) {
        // Provenance rows must be at least 1ms apart so the verifier's
        // (created_at, id) ordering matches our intended write order.
        await new Promise((r) => setTimeout(r, 2));
        const createdAt = new Date().toISOString();
        const canonical = {
          id: provIds[i],
          workspace_id: workspace,
          actor_user_id: actor,
          actor_type: "ai_agent",
          capsule_id: null,
          run_id: null,
          action: `provenance.action.${i}`,
          object_type: null,
          object_id: null,
          metadata: { version_id: `v${i}` },
          created_at: createdAt,
        };
        const rowHash = provHash({
          prevHash: provPrev,
          canonicalFields: canonical,
        });
        const row: PreparedProvenanceRow = {
          id: provIds[i],
          workspace_id: workspace,
          actor_user_id: actor,
          actor_type: "ai_agent",
          capsule_id: null,
          run_id: null,
          action: `provenance.action.${i}`,
          object_type: null,
          object_id: null,
          metadata: { version_id: `v${i}` },
          created_at: createdAt,
          prev_hash: provPrev,
          row_hash: rowHash,
          canonicalization_version: CANONICALIZATION_VERSION,
        };
        await provWriter.writer(row);
        provPrev = rowHash;
        provTip = rowHash;
      }

      // Operator chain: must reference an audit_events.id (V4-R7).
      // Pull the most recent audit row's id + create a session for the
      // FK.
      const auditRows = await db.sql<{ id: string }[]>`
        SELECT id FROM audit_events ORDER BY created_at DESC LIMIT 1
      `;
      const auditEventId = auditRows[0].id;
      const f = bindFactories(db.sql);
      const operatorUser = await f.makeUser({
        email: "operator@example.test",
      });
      const operatorSession = await f.makeSession(operatorUser);

      const opWriter = new AuditDbWriter({ pool, logType: "operator" });
      const opId = randomUUID();
      const startedAt = new Date().toISOString();
      const opCanonical = {
        id: opId,
        actor_user_id: operatorUser.id,
        capability: "platform:audit_read",
        reason: "incident #12 forensic read",
        target_workspace_id: workspace,
        target_user_id: null,
        session_id: operatorSession.id,
        audit_event_id: auditEventId,
        started_at: startedAt,
        ended_at: null,
      };
      const opHash = provHash({
        prevHash: null,
        canonicalFields: opCanonical,
      });
      const opRow: PreparedOperatorRow = {
        id: opId,
        actor_user_id: operatorUser.id,
        capability: "platform:audit_read",
        reason: "incident #12 forensic read",
        target_workspace_id: workspace,
        target_user_id: null,
        session_id: operatorSession.id,
        audit_event_id: auditEventId,
        started_at: startedAt,
        ended_at: null,
        prev_hash: null,
        row_hash: opHash,
        canonicalization_version: CANONICALIZATION_VERSION,
      };
      await opWriter.writer(opRow);

      // All three verifiers run cleanly.
      const auditReport = await new AuditChainVerifier({
        pool,
        logType: "audit",
      }).verifyAll();
      expect(auditReport.ok).toBe(true);
      if (auditReport.ok) {
        expect(auditReport.rowsVerified).toBe(2);
        expect(auditReport.tipHash).toBe(auditTip);
      }

      const provReport = await new AuditChainVerifier({
        pool,
        logType: "provenance",
      }).verifyAll();
      expect(provReport.ok).toBe(true);
      if (provReport.ok) {
        expect(provReport.rowsVerified).toBe(2);
        expect(provReport.tipHash).toBe(provTip);
      }

      const opReport = await new AuditChainVerifier({
        pool,
        logType: "operator",
      }).verifyAll();
      expect(opReport.ok).toBe(true);
      if (opReport.ok) {
        expect(opReport.rowsVerified).toBe(1);
        expect(opReport.tipHash).toBe(opHash);
      }
    });

    it("empty chain verifies cleanly with rowsVerified=0 and tipHash=null", async () => {
      const verifier = new AuditChainVerifier({ pool, logType: "audit" });
      const report = await verifier.verifyAll();
      expect(report.ok).toBe(true);
      if (report.ok) {
        expect(report.rowsVerified).toBe(0);
        expect(report.tipHash).toBeNull();
      }
    });
  },
);

describe.runIf(!HAS_TEST_DB)(
  "L3.1 — AuditChainVerifier tests skipped (no PLASMAWORK_TEST_DB_URL)",
  () => {
    it("skipped because PLASMAWORK_TEST_DB_URL is not set", () => {
      expect(TEST_DB_SKIP_REASON).toMatch(/PLASMAWORK_TEST_DB_URL/);
    });
  },
);

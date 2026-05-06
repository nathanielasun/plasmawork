/**
 * L3.3 ApprovalService — behavior tests.
 *
 * Postgres-gated via `PLASMAWORK_TEST_DB_URL` (the L1.5 contract). Cases:
 *
 *   1.  `requestApproval` happy path — row pending + audit row.
 *   2.  `issueToken` user-bound — row exists; context hash is 64-hex.
 *   3.  `consumeToken` happy path (user-bound) — used_at set + granted.
 *   4.  Replay: consume same raw token twice — second call throws
 *       APPROVAL_TOKEN_REUSED + denied audit.
 *   5.  Expired token (clock-seam) — INVALID + denied audit.
 *   6.  Revoked token — INVALID + denied audit.
 *   7.  Parent denied between issuance and consumption — atomic update
 *       returns 0 rows → INVALID.
 *   8.  Wrong consumer (user-bound, different user) — INVALID.
 *   9.  Token context mismatch: hand-mutate `requested_action` post-issue;
 *       consume sees mismatch → APPROVAL_CONTEXT_MISMATCH + audit.
 *   10. Role-bound token + consumer with the role in same workspace.
 *   11. Role-bound token + consumer with the role in DIFFERENT workspace
 *       only → INVALID (§16.2.4 #4).
 *   12. `denyRequest` revokes outstanding tokens; consumption then fails.
 *
 * The audit logger is wired with an in-memory writer + getter so the
 * tests can assert per-call audit traces without a second hash-chain
 * verifier.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";

import {
  HAS_TEST_DB,
  TEST_DB_SKIP_REASON,
  createScratchDb,
  resetTestDb,
  bindFactories,
  type ScratchDb,
} from "../fixtures/index.js";

import { ApprovalService } from "../../src/approvals/service.js";
import {
  AuditLogger,
  type PreparedAuditRow,
} from "../../src/audit/logger.js";
import * as schema from "../../src/db/schema.js";
import type { SecureCorePool } from "../../src/db/pool.js";
import { hashToken } from "../../src/crypto/tokens.js";

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

function poolFor(db: ScratchDb): SecureCorePool {
  return {
    role: "app",
    sql: db.sql,
    db: drizzle(db.sql, { schema }),
    close: async () => {
      // owned by the scratch DB lifecycle, not by us.
    },
  };
}

const HMAC_KEY = Buffer.from("test-approval-hmac-key-32bytes!!", "utf8");

describe.skipIf(!HAS_TEST_DB)("L3.3 — ApprovalService", () => {
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

  it("requestApproval inserts a pending row and emits approval.requested", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const ws = await f.makeWorkspace(requester);

    const row = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_001",
    });

    expect(row.status).toBe("pending");
    expect(row.workspace_id).toBe(ws.id);
    expect(row.requested_action).toBe("tool.approve_promotion");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe("approval.requested");
    expect(audit.rows[0].result).toBe("succeeded");
    expect(audit.rows[0].object_id).toBe(row.id);
  });

  it("issueToken (user-bound) writes a row whose context hash is 64-hex", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const approver = await f.makeUser();
    const ws = await f.makeWorkspace(requester);

    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "run.approve_hpc",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_002",
    });

    const { rawToken, tokenRow } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: approver.id,
      approverRoleId: null,
      createdBy: requester.id,
      requestId: "req_003",
    });

    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenRow.approval_request_id).toBe(req.id);
    expect(tokenRow.approver_user_id).toBe(approver.id);
    expect(tokenRow.approver_role_id).toBeNull();
    expect(tokenRow.token_context_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("consumeToken happy path sets used_at and emits approval.granted", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const approver = await f.makeUser();
    const ws = await f.makeWorkspace(requester);

    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_004",
    });
    const { rawToken } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: approver.id,
      approverRoleId: null,
      createdBy: requester.id,
      requestId: "req_005",
    });

    const before = audit.rows.length;
    const result = await svc.consumeToken({
      presentedToken: rawToken,
      expectedRequestId: req.id,
      expectedAction: "tool.approve_promotion",
      consumerUserId: approver.id,
      consumerRoleIds: [],
      requestId: "req_006",
    });

    expect(result.tokenRow.used_at).toBeInstanceOf(Date);
    expect(result.requestRow.id).toBe(req.id);
    const granted = audit.rows.slice(before);
    expect(granted).toHaveLength(1);
    expect(granted[0].action).toBe("approval.granted");
    expect(granted[0].result).toBe("succeeded");
  });

  it("replay throws APPROVAL_TOKEN_REUSED on second consume", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const approver = await f.makeUser();
    const ws = await f.makeWorkspace(requester);
    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_007",
    });
    const { rawToken } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: approver.id,
      approverRoleId: null,
      createdBy: requester.id,
      requestId: "req_008",
    });

    await svc.consumeToken({
      presentedToken: rawToken,
      expectedRequestId: req.id,
      expectedAction: "tool.approve_promotion",
      consumerUserId: approver.id,
      consumerRoleIds: [],
      requestId: "req_009",
    });

    const before = audit.rows.length;
    await expect(
      svc.consumeToken({
        presentedToken: rawToken,
        expectedRequestId: req.id,
        expectedAction: "tool.approve_promotion",
        consumerUserId: approver.id,
        consumerRoleIds: [],
        requestId: "req_010",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_TOKEN_REUSED" });
    const denied = audit.rows.slice(before);
    expect(denied).toHaveLength(1);
    expect(denied[0].action).toBe("approval.denied");
  });

  it("expired token throws and emits approval.denied", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    // Clock seam: pretend "now" is far in the past at issuance, then jump
    // forward past expiry before consumption.
    let clock = Date.now();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
      now: () => clock,
      defaultTtlMs: 1_000,
    });

    const requester = await f.makeUser();
    const approver = await f.makeUser();
    const ws = await f.makeWorkspace(requester);
    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_011",
    });
    const { rawToken, tokenRow } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: approver.id,
      approverRoleId: null,
      createdBy: requester.id,
      requestId: "req_012",
    });

    // Force the row's expires_at into the past (DB is the gate, not the
    // service clock).
    await db.sql`
      UPDATE approval_tokens SET expires_at = now() - interval '1 second'
      WHERE id = ${tokenRow.id}
    `;
    // Also bump the recomputed-context-hash input so it stays consistent
    // (expires_at is part of the hash). Re-issuing would be cleaner, but
    // a real expiry path mutates only the row, and the recompute uses the
    // NEW expires_at — so we need to overwrite token_context_hash too to
    // isolate "expired" from "context mismatch".
    // Recompute from updated row.
    const updated = await db.sql<
      Array<{ workspace_id: string; expires_at: Date; requested_action: string }>
    >`
      SELECT t.workspace_id, t.expires_at, r.requested_action
      FROM approval_tokens t
      JOIN approval_requests r ON r.id = t.approval_request_id
      WHERE t.id = ${tokenRow.id}
    `;
    const u = updated[0];
    // We can't directly invoke the private hash, so use the same library
    // helpers the service uses.
    const { hmacSha256 } = await import("../../src/crypto/hmac.js");
    const { canonicalize } = await import("../../src/crypto/jcs.js");
    const newHash = hmacSha256(
      HMAC_KEY,
      canonicalize({
        approval_request_id: req.id,
        workspace_id: u.workspace_id,
        requested_action: u.requested_action,
        approver_constraint: { approver_user_id: approver.id },
        expires_at: u.expires_at.toISOString(),
      }),
    );
    await db.sql`
      UPDATE approval_tokens SET token_context_hash = ${newHash}
      WHERE id = ${tokenRow.id}
    `;

    clock += 60 * 60 * 1000;
    const before = audit.rows.length;
    await expect(
      svc.consumeToken({
        presentedToken: rawToken,
        expectedRequestId: req.id,
        expectedAction: "tool.approve_promotion",
        consumerUserId: approver.id,
        consumerRoleIds: [],
        requestId: "req_013",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_TOKEN_INVALID" });
    expect(audit.rows.slice(before).some((r) => r.action === "approval.denied"))
      .toBe(true);
  });

  it("revoked token throws", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const approver = await f.makeUser();
    const ws = await f.makeWorkspace(requester);
    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_014",
    });
    const { rawToken, tokenRow } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: approver.id,
      approverRoleId: null,
      createdBy: requester.id,
      requestId: "req_015",
    });

    await db.sql`
      UPDATE approval_tokens SET revoked_at = now() WHERE id = ${tokenRow.id}
    `;

    await expect(
      svc.consumeToken({
        presentedToken: rawToken,
        expectedRequestId: req.id,
        expectedAction: "tool.approve_promotion",
        consumerUserId: approver.id,
        consumerRoleIds: [],
        requestId: "req_016",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_TOKEN_INVALID" });
  });

  it("parent request denied between issuance and consumption fails atomically", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const approver = await f.makeUser();
    const decider = await f.makeUser();
    const ws = await f.makeWorkspace(requester);

    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_017",
    });
    const { rawToken } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: approver.id,
      approverRoleId: null,
      createdBy: requester.id,
      requestId: "req_018",
    });

    // denyRequest also revokes tokens → consumption must fail.
    await svc.denyRequest({
      approvalRequestId: req.id,
      decidedBy: decider.id,
      requestId: "req_019",
    });

    await expect(
      svc.consumeToken({
        presentedToken: rawToken,
        expectedRequestId: req.id,
        expectedAction: "tool.approve_promotion",
        consumerUserId: approver.id,
        consumerRoleIds: [],
        requestId: "req_020",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_TOKEN_INVALID" });
  });

  it("wrong consumer (user-bound) throws APPROVAL_TOKEN_INVALID", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const approver = await f.makeUser();
    const intruder = await f.makeUser();
    const ws = await f.makeWorkspace(requester);
    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_021",
    });
    const { rawToken } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: approver.id,
      approverRoleId: null,
      createdBy: requester.id,
      requestId: "req_022",
    });

    await expect(
      svc.consumeToken({
        presentedToken: rawToken,
        expectedRequestId: req.id,
        expectedAction: "tool.approve_promotion",
        consumerUserId: intruder.id,
        consumerRoleIds: [],
        requestId: "req_023",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_TOKEN_INVALID" });
  });

  it("token context mismatch (mutated requested_action) emits token_context_mismatch", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const approver = await f.makeUser();
    const ws = await f.makeWorkspace(requester);
    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_024",
    });
    const { rawToken } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: approver.id,
      approverRoleId: null,
      createdBy: requester.id,
      requestId: "req_025",
    });

    // Hand-mutate the parent request's `requested_action` AFTER the
    // token's context hash was sealed. The recompute on consume will
    // disagree with the stored hash → fail closed.
    await db.sql`
      UPDATE approval_requests SET requested_action = 'tampered.action'
      WHERE id = ${req.id}
    `;

    const before = audit.rows.length;
    await expect(
      svc.consumeToken({
        presentedToken: rawToken,
        // Match the (tampered) current value so step-(4) doesn't trip
        // first; we want step-(3) to be the gate.
        expectedRequestId: req.id,
        expectedAction: "tampered.action",
        consumerUserId: approver.id,
        consumerRoleIds: [],
        requestId: "req_026",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_CONTEXT_MISMATCH" });
    const emitted = audit.rows.slice(before);
    expect(emitted.some((r) => r.action === "approval.token_context_mismatch"))
      .toBe(true);
  });

  it("role-bound token: consumer with role in the request workspace succeeds", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const consumer = await f.makeUser();
    const ws = await f.makeWorkspace(requester);
    await f.makeMember(ws, consumer, "Reviewer");
    const reviewerRoleId = await f.getRoleId("Reviewer");

    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_027",
    });
    const { rawToken } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: null,
      approverRoleId: reviewerRoleId,
      createdBy: requester.id,
      requestId: "req_028",
    });

    const result = await svc.consumeToken({
      presentedToken: rawToken,
      expectedRequestId: req.id,
      expectedAction: "tool.approve_promotion",
      consumerUserId: consumer.id,
      consumerRoleIds: [reviewerRoleId],
      requestId: "req_029",
    });
    expect(result.tokenRow.used_at).toBeInstanceOf(Date);
  });

  it("role-bound token: role held only in a different workspace is rejected", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const consumer = await f.makeUser();
    const wsA = await f.makeWorkspace(requester);
    const wsB = await f.makeWorkspace(requester, { name: "ws-b" });
    // Consumer holds Reviewer role in wsB, NOT wsA.
    await f.makeMember(wsB, consumer, "Reviewer");
    const reviewerRoleId = await f.getRoleId("Reviewer");

    // Approval request lives in wsA.
    const req = await svc.requestApproval({
      workspaceId: wsA.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_030",
    });
    const { rawToken } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: null,
      approverRoleId: reviewerRoleId,
      createdBy: requester.id,
      requestId: "req_031",
    });

    await expect(
      svc.consumeToken({
        presentedToken: rawToken,
        expectedRequestId: req.id,
        expectedAction: "tool.approve_promotion",
        consumerUserId: consumer.id,
        consumerRoleIds: [reviewerRoleId],
        requestId: "req_032",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_TOKEN_INVALID" });
  });

  it("denyRequest revokes outstanding tokens; subsequent consumption fails", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditHarness();
    const svc = new ApprovalService({
      pool: poolFor(db),
      auditLogger: audit.logger,
      approvalHmacKey: HMAC_KEY,
    });

    const requester = await f.makeUser();
    const approver = await f.makeUser();
    const decider = await f.makeUser();
    const ws = await f.makeWorkspace(requester);
    const req = await svc.requestApproval({
      workspaceId: ws.id,
      objectType: "capsule",
      objectId: randomUUID(),
      requestedAction: "tool.approve_promotion",
      requestedBy: requester.id,
      requestedByAgent: false,
      requestId: "req_033",
    });
    const { rawToken, tokenRow } = await svc.issueToken({
      approvalRequestId: req.id,
      approverUserId: approver.id,
      approverRoleId: null,
      createdBy: requester.id,
      requestId: "req_034",
    });

    await svc.denyRequest({
      approvalRequestId: req.id,
      decidedBy: decider.id,
      requestId: "req_035",
    });

    const tokAfter = await db.sql<{ revoked_at: Date | null }[]>`
      SELECT revoked_at FROM approval_tokens WHERE id = ${tokenRow.id}
    `;
    expect(tokAfter[0].revoked_at).not.toBeNull();

    // Hash lookup would still find the row (still by token_hash); the
    // recompute would still match (no row mutation that touches the
    // hash inputs); failure happens at the atomic UPDATE because
    // revoked_at IS NOT NULL.
    expect(hashToken(rawToken)).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      svc.consumeToken({
        presentedToken: rawToken,
        expectedRequestId: req.id,
        expectedAction: "tool.approve_promotion",
        consumerUserId: approver.id,
        consumerRoleIds: [],
        requestId: "req_036",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_TOKEN_INVALID" });
  });
});

describe.runIf(!HAS_TEST_DB)("L3.3 — ApprovalService suite skipped", () => {
  it("documents how to enable", () => {
    expect(HAS_TEST_DB).toBe(false);
    // eslint-disable-next-line no-console
    console.warn(TEST_DB_SKIP_REASON);
  });
});

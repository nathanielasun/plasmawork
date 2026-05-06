/**
 * L3.4 capsule version + lock service — behavior tests.
 *
 * Postgres-gated via L1.5 (`PLASMAWORK_TEST_DB_URL`). When unset, the
 * suite skips cleanly with the standard message.
 *
 * Pins:
 *   1. acquireLock happy path → row persisted; raw token hashes to
 *      stored hash; lockContextHash agrees with the canonicalized
 *      quadruple.
 *   2. acquireLock while held → VERSION_CONFLICT (lock_held).
 *   3. acquireLock after stale lock → succeeds; the stale row is
 *      replaced.
 *   4. releaseLock with the matching token → row gone.
 *   5. releaseLock with a mismatched token → no DB change + audit row
 *      with denied_reason: lock_release_mismatch.
 *   6. updateCapsule happy path → version_number increments;
 *      currentVersionId updates; audit row carries version_id +
 *      previous_version_id.
 *   7. updateCapsule with stale expectedBaseVersionId →
 *      VERSION_CONFLICT.
 *   8. updateCapsule parallel race → exactly one succeeds; the late
 *      writer trips the unique-index violation we re-throw as
 *      VERSION_CONFLICT.
 *   9. updateCapsule with valid lockToken → the lock is released
 *      atomically; a fresh acquireLock works.
 *  10. forkCapsule → new capsule + v1 with shared content_hash;
 *      capsule.forked audit emitted.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";

import {
  HAS_TEST_DB,
  TEST_DB_SKIP_REASON,
  createScratchDb,
  resetTestDb,
  type ScratchDb,
} from "../helpers/db.js";
import { bindFactories } from "../fixtures/factories.js";
import { AuditLogger, type PreparedAuditRow } from "../../src/audit/logger.js";
import { hashToken } from "../../src/crypto/tokens.js";
import { canonicalize } from "../../src/crypto/jcs.js";
import { CapsuleVersionLockService } from "../../src/capsules/versionLock.js";
import { VersionConflictError } from "../../src/errors/shapes.js";

interface AuditObserver {
  logger: AuditLogger;
  rows: PreparedAuditRow[];
}

function makeAuditObserver(): AuditObserver {
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

describe.skipIf(!HAS_TEST_DB)("L3.4 — capsule version + lock service", () => {
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

  it("acquireLock happy path persists the row and hashes match", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);
    const cap = await f.makeCapsule(ws, u);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    const result = await svc.acquireLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      lockedBy: u.id,
      requestId: "req_acq_01",
      lockContext: {
        baseVersionId: cap.version!.id,
        reason: "edit",
      },
    });

    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.lockRow.lock_token_hash).toBe(hashToken(result.rawToken));

    const expectedContextHash = hashToken(
      canonicalize({
        capsuleId: cap.capsule.id,
        workspaceId: ws.id,
        baseVersionId: cap.version!.id,
        lockedBy: u.id,
      }),
    );
    expect(result.lockRow.lock_context_hash).toBe(expectedContextHash);

    const stored = await db.sql<
      { lock_token_hash: string; locked_by: string }[]
    >`
      SELECT lock_token_hash, locked_by FROM capsule_locks
      WHERE capsule_id = ${cap.capsule.id}
    `;
    expect(stored.length).toBe(1);
    expect(stored[0].lock_token_hash).toBe(hashToken(result.rawToken));
    expect(stored[0].locked_by).toBe(u.id);
  });

  it("acquireLock while another lock is held throws VERSION_CONFLICT", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u1 = await f.makeUser();
    const u2 = await f.makeUser();
    const ws = await f.makeWorkspace(u1);
    const cap = await f.makeCapsule(ws, u1);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    await svc.acquireLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      lockedBy: u1.id,
      requestId: "req_first",
      lockContext: { baseVersionId: cap.version!.id, reason: "edit" },
    });

    await expect(
      svc.acquireLock({
        capsuleId: cap.capsule.id,
        workspaceId: ws.id,
        lockedBy: u2.id,
        requestId: "req_second",
        lockContext: { baseVersionId: cap.version!.id, reason: "edit" },
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      details: { conflict: "lock_held" },
    });
  });

  it("acquireLock after a stale lock replaces the expired row", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u1 = await f.makeUser();
    const u2 = await f.makeUser();
    const ws = await f.makeWorkspace(u1);
    const cap = await f.makeCapsule(ws, u1);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    // First holder takes the lock with a 60s TTL but we manually
    // backdate `expires_at` to simulate a stale lock.
    const first = await svc.acquireLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      lockedBy: u1.id,
      requestId: "req_first",
      lockContext: { baseVersionId: cap.version!.id, reason: "edit" },
    });
    await db.sql`
      UPDATE capsule_locks
      SET expires_at = now() - INTERVAL '1 hour'
      WHERE capsule_id = ${cap.capsule.id}
    `;

    const second = await svc.acquireLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      lockedBy: u2.id,
      requestId: "req_second",
      lockContext: { baseVersionId: cap.version!.id, reason: "edit" },
    });

    expect(second.rawToken).not.toBe(first.rawToken);

    const stored = await db.sql<
      { lock_token_hash: string; locked_by: string }[]
    >`
      SELECT lock_token_hash, locked_by FROM capsule_locks
      WHERE capsule_id = ${cap.capsule.id}
    `;
    expect(stored.length).toBe(1);
    expect(stored[0].locked_by).toBe(u2.id);
    expect(stored[0].lock_token_hash).toBe(hashToken(second.rawToken));
  });

  it("releaseLock with the correct token deletes the row", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);
    const cap = await f.makeCapsule(ws, u);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    const acq = await svc.acquireLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      lockedBy: u.id,
      requestId: "req_acq",
      lockContext: { baseVersionId: cap.version!.id, reason: "edit" },
    });

    await svc.releaseLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      actorUserId: u.id,
      actorType: "human",
      requestId: "req_rel",
      presentedRawToken: acq.rawToken,
      expectedContext: { baseVersionId: cap.version!.id, lockedBy: u.id },
    });

    const remaining = await db.sql`
      SELECT 1 FROM capsule_locks WHERE capsule_id = ${cap.capsule.id}
    `;
    expect(remaining.length).toBe(0);

    // No audit row for a clean release — the rejection path is the
    // observable one.
    const rejections = audit.rows.filter(
      (r) =>
        r.action === "capsule.read" &&
        r.metadata.denied_reason === "lock_release_mismatch",
    );
    expect(rejections.length).toBe(0);
  });

  it("releaseLock with a mismatched token is a no-op + emits audit", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);
    const cap = await f.makeCapsule(ws, u);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    await svc.acquireLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      lockedBy: u.id,
      requestId: "req_acq",
      lockContext: { baseVersionId: cap.version!.id, reason: "edit" },
    });

    await svc.releaseLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      actorUserId: u.id,
      actorType: "human",
      requestId: "req_rel",
      presentedRawToken: "WRONG_TOKEN_VALUE_THAT_DOES_NOT_MATCH",
      expectedContext: { baseVersionId: cap.version!.id, lockedBy: u.id },
    });

    const remaining = await db.sql`
      SELECT 1 FROM capsule_locks WHERE capsule_id = ${cap.capsule.id}
    `;
    expect(remaining.length).toBe(1);

    const rejections = audit.rows.filter(
      (r) =>
        r.action === "capsule.read" &&
        r.result === "denied" &&
        r.metadata.denied_reason === "lock_release_mismatch",
    );
    expect(rejections.length).toBe(1);
    expect(rejections[0].object_id).toBe(cap.capsule.id);
    expect(rejections[0].request_id).toBe("req_rel");
  });

  it("updateCapsule happy path increments version and emits audit", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);
    const cap = await f.makeCapsule(ws, u);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    const result = await svc.updateCapsule({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      expectedBaseVersionId: cap.version!.id,
      newContent: {
        contentHash: "sha256:newcontent",
        storagePath: `workspaces/${ws.id}/capsules/${cap.capsule.id}/v2`,
      },
      actorUserId: u.id,
      actorType: "human",
      requestId: "req_update_01",
    });

    expect(result.versionNumber).toBe(2);

    const updatedCapsule = await db.sql<
      { current_version_id: string }[]
    >`
      SELECT current_version_id FROM capsules WHERE id = ${cap.capsule.id}
    `;
    expect(updatedCapsule[0].current_version_id).toBe(result.newVersionId);

    const versions = await db.sql<
      { id: string; version_number: number; content_hash: string }[]
    >`
      SELECT id, version_number, content_hash
      FROM capsule_versions
      WHERE capsule_id = ${cap.capsule.id}
      ORDER BY version_number ASC
    `;
    expect(versions.length).toBe(2);
    expect(versions[1].id).toBe(result.newVersionId);
    expect(versions[1].version_number).toBe(2);
    expect(versions[1].content_hash).toBe("sha256:newcontent");

    const updates = audit.rows.filter((r) => r.action === "capsule.updated");
    expect(updates.length).toBe(1);
    expect(updates[0].object_id).toBe(cap.capsule.id);
    expect(updates[0].metadata.version_id).toBe(result.newVersionId);
    expect(updates[0].metadata.previous_version_id).toBe(cap.version!.id);
  });

  it("updateCapsule with stale expectedBaseVersionId throws VERSION_CONFLICT", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);
    const cap = await f.makeCapsule(ws, u);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    // First update: takes the capsule to v2.
    const v2 = await svc.updateCapsule({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      expectedBaseVersionId: cap.version!.id,
      newContent: {
        contentHash: "sha256:v2",
        storagePath: "p/v2",
      },
      actorUserId: u.id,
      actorType: "human",
      requestId: "req_v2",
    });

    // Second update tries to base on the original v1 — stale.
    await expect(
      svc.updateCapsule({
        capsuleId: cap.capsule.id,
        workspaceId: ws.id,
        expectedBaseVersionId: cap.version!.id,
        newContent: {
          contentHash: "sha256:v3",
          storagePath: "p/v3",
        },
        actorUserId: u.id,
        actorType: "human",
        requestId: "req_v3",
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      details: {
        conflict: "stale_base_version",
        currentVersionId: v2.newVersionId,
        submittedBaseVersionId: cap.version!.id,
      },
    });
  });

  it("updateCapsule parallel race: exactly one succeeds, the other VERSION_CONFLICT", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);
    const cap = await f.makeCapsule(ws, u);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    const baseId = cap.version!.id;
    const calls = await Promise.allSettled([
      svc.updateCapsule({
        capsuleId: cap.capsule.id,
        workspaceId: ws.id,
        expectedBaseVersionId: baseId,
        newContent: { contentHash: "sha256:a", storagePath: "p/a" },
        actorUserId: u.id,
        actorType: "human",
        requestId: "req_race_a",
      }),
      svc.updateCapsule({
        capsuleId: cap.capsule.id,
        workspaceId: ws.id,
        expectedBaseVersionId: baseId,
        newContent: { contentHash: "sha256:b", storagePath: "p/b" },
        actorUserId: u.id,
        actorType: "human",
        requestId: "req_race_b",
      }),
    ]);

    const fulfilled = calls.filter((c) => c.status === "fulfilled");
    const rejected = calls.filter((c) => c.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(VersionConflictError);
    expect((reason as VersionConflictError).code).toBe("VERSION_CONFLICT");

    const versions = await db.sql<{ version_number: number }[]>`
      SELECT version_number FROM capsule_versions
      WHERE capsule_id = ${cap.capsule.id}
      ORDER BY version_number ASC
    `;
    expect(versions.map((v) => v.version_number)).toEqual([1, 2]);
  });

  it("updateCapsule with a valid lockToken releases the lock atomically", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);
    const cap = await f.makeCapsule(ws, u);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    const acq = await svc.acquireLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      lockedBy: u.id,
      requestId: "req_acq",
      lockContext: { baseVersionId: cap.version!.id, reason: "edit" },
    });

    await svc.updateCapsule({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      expectedBaseVersionId: cap.version!.id,
      newContent: { contentHash: "sha256:locked", storagePath: "p/locked" },
      actorUserId: u.id,
      actorType: "human",
      requestId: "req_update",
      lockToken: acq.rawToken,
    });

    const remainingLocks = await db.sql`
      SELECT 1 FROM capsule_locks WHERE capsule_id = ${cap.capsule.id}
    `;
    expect(remainingLocks.length).toBe(0);

    // Subsequent acquireLock works without conflict.
    const reacq = await svc.acquireLock({
      capsuleId: cap.capsule.id,
      workspaceId: ws.id,
      lockedBy: u.id,
      requestId: "req_reacq",
      lockContext: {
        baseVersionId: (
          await db.sql<
            { current_version_id: string }[]
          >`SELECT current_version_id FROM capsules WHERE id = ${cap.capsule.id}`
        )[0].current_version_id,
        reason: "edit",
      },
    });
    expect(reacq.rawToken).not.toBe(acq.rawToken);
  });

  it("forkCapsule creates a new capsule with v1 + emits capsule.forked", async () => {
    const f = bindFactories(db.sql);
    const audit = makeAuditObserver();
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);
    const cap = await f.makeCapsule(ws, u);
    const svc = new CapsuleVersionLockService({
      sql: db.sql,
      auditLogger: audit.logger,
    });

    const fork = await svc.forkCapsule({
      sourceCapsuleId: cap.capsule.id,
      sourceVersionId: cap.version!.id,
      targetWorkspaceId: ws.id,
      newCapsuleName: "fork-of-original",
      actorUserId: u.id,
      actorType: "human",
      requestId: "req_fork",
    });

    const forkedCapsule = await db.sql<
      {
        id: string;
        name: string;
        current_version_id: string;
      }[]
    >`
      SELECT id, name, current_version_id FROM capsules
      WHERE id = ${fork.newCapsuleId}
    `;
    expect(forkedCapsule.length).toBe(1);
    expect(forkedCapsule[0].name).toBe("fork-of-original");
    expect(forkedCapsule[0].current_version_id).toBe(fork.newVersionId);

    const forkedVersion = await db.sql<
      {
        id: string;
        version_number: number;
        content_hash: string;
        storage_path: string;
      }[]
    >`
      SELECT id, version_number, content_hash, storage_path
      FROM capsule_versions
      WHERE id = ${fork.newVersionId}
    `;
    expect(forkedVersion[0].version_number).toBe(1);
    expect(forkedVersion[0].content_hash).toBe(cap.version!.content_hash);
    expect(forkedVersion[0].storage_path).toBe(cap.version!.storage_path);

    const forkAudits = audit.rows.filter((r) => r.action === "capsule.forked");
    expect(forkAudits.length).toBe(1);
    expect(forkAudits[0].object_id).toBe(fork.newCapsuleId);
    expect(forkAudits[0].metadata.version_id).toBe(fork.newVersionId);
  });
});

describe.runIf(!HAS_TEST_DB)("L3.4 — capsule version + lock suite skipped", () => {
  it("documents how to enable", () => {
    // eslint-disable-next-line no-console
    console.warn(TEST_DB_SKIP_REASON);
    expect(HAS_TEST_DB).toBe(false);
  });
});

/**
 * WorkspaceService — Phase 0.5 audit fix F4 behavioral regression
 * (2026-05-09).
 *
 * Pins the F4 invariant *behaviorally*, not just structurally:
 *
 *   When the membership transaction rolls back at commit time, the
 *   audit logger receives ZERO writes. The audit chain MUST never
 *   carry a phantom row for a tx that did not commit.
 *
 * The convention checker grep for `emitAudit` proves the helper exists;
 * this test proves the ordering. A future refactor that moves the
 * `auditLogger.write` call back into the `sqlClient.begin(...)` callback
 * — or that fires the write before `await begin(...)` resolves — fails
 * here.
 */

import { describe, it, expect } from "vitest";

import { WorkspaceService } from "../../src/workspaces/service.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { SecureCorePool } from "../../src/db/pool.js";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const WS = "33333333-3333-4333-8333-333333333333";
const ROLE = "44444444-4444-4444-8444-444444444444";
const NEW_ROLE = "55555555-5555-4555-8555-555555555555";
const MEMBERSHIP = "66666666-6666-4666-8666-666666666666";

interface AuditCall {
  action: string;
  result: string;
  actorUserId: string | null;
}

function makeAuditStub(): {
  logger: AuditLogger;
  calls: AuditCall[];
} {
  const calls: AuditCall[] = [];
  const logger = {
    async write(input: {
      action: string;
      result: string;
      actorUserId: string | null;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        actorUserId: input.actorUserId,
      });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

/**
 * A queue-driven stub for the postgres.js tagged-template `tx` symbol.
 * Each call (regardless of the SQL string) pops the next canned
 * response from `responses`.
 */
function makeQueuedTx(
  responses: ReadonlyArray<readonly unknown[]>,
): (...args: unknown[]) => Promise<readonly unknown[]> {
  let i = 0;
  return async () => {
    const out = responses[i] ?? [];
    i += 1;
    return out;
  };
}

interface PoolStub {
  readonly pool: SecureCorePool;
  /** Set true to make begin() reject after the callback completes. */
  readonly rollback: { value: boolean };
  /** Captures whether the inner callback ran to completion. */
  readonly callbackResolved: { value: boolean };
}

function makePool(opts: {
  readonly responsesPerBegin: ReadonlyArray<readonly unknown[]>;
}): PoolStub {
  const rollback = { value: false };
  const callbackResolved = { value: false };
  const sql = (async () => {
    throw new Error("sql() called outside of begin");
  }) as unknown as SecureCorePool["sql"];
  // Augment the function-shaped sql with `.begin`.
  (
    sql as unknown as {
      begin: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    }
  ).begin = async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = makeQueuedTx(opts.responsesPerBegin);
    const result = await fn(tx);
    callbackResolved.value = true;
    if (rollback.value) {
      throw new Error("Simulated tx rollback at commit");
    }
    return result;
  };
  return {
    pool: { sql } as unknown as SecureCorePool,
    rollback,
    callbackResolved,
  };
}

describe("WorkspaceService — F4: audit emission outside the membership tx", () => {
  // -----------------------------------------------------------------
  // addMember
  // -----------------------------------------------------------------

  it("addMember: tx rollback at commit emits ZERO audit writes", async () => {
    const audit = makeAuditStub();
    const responses: ReadonlyArray<readonly unknown[]> = [
      [{ ok: 1 }], // assertCanManageMembersAtCommit — capability present
      [{ id: ROLE }], // role lookup
      [], // existing membership — none
      [
        {
          id: MEMBERSHIP,
          workspace_id: WS,
          user_id: TARGET,
          role_id: ROLE,
          created_at: new Date("2026-05-09T00:00:00Z"),
        },
      ], // INSERT membership RETURNING
      [], // INSERT workspace_membership_events
    ];
    const stub = makePool({ responsesPerBegin: responses });
    stub.rollback.value = true;

    const svc = new WorkspaceService({
      pool: stub.pool,
      auditLogger: audit.logger,
    });

    await expect(
      svc.addMember({
        workspaceId: WS,
        targetUserId: TARGET,
        roleName: "researcher",
        actorUserId: ACTOR,
        requestId: "req-1",
      }),
    ).rejects.toThrow(/rollback/i);

    // The inner callback DID complete — the rollback fires only at
    // commit time, after the service has decided emitAudit=true. If
    // audit-emit were inside the callback, this stub setup would have
    // already recorded a write.
    expect(stub.callbackResolved.value).toBe(true);
    // But audit writes happen AFTER the begin() promise resolves — and
    // begin() rejected, so audit MUST be empty.
    expect(audit.calls).toHaveLength(0);
  });

  it("addMember: tx commit emits exactly one workspace.member_added audit (post-tx)", async () => {
    const audit = makeAuditStub();
    const responses: ReadonlyArray<readonly unknown[]> = [
      [{ ok: 1 }],
      [{ id: ROLE }],
      [],
      [
        {
          id: MEMBERSHIP,
          workspace_id: WS,
          user_id: TARGET,
          role_id: ROLE,
          created_at: new Date("2026-05-09T00:00:00Z"),
        },
      ],
      [],
    ];
    const stub = makePool({ responsesPerBegin: responses });
    stub.rollback.value = false;

    const svc = new WorkspaceService({
      pool: stub.pool,
      auditLogger: audit.logger,
    });

    const out = await svc.addMember({
      workspaceId: WS,
      targetUserId: TARGET,
      roleName: "researcher",
      actorUserId: ACTOR,
      requestId: "req-2",
    });

    expect(out.id).toBe(MEMBERSHIP);
    expect(audit.calls).toEqual([
      {
        action: "workspace.member_added",
        result: "succeeded",
        actorUserId: ACTOR,
      },
    ]);
  });

  it("addMember: idempotent existing-membership path emits ZERO audit writes", async () => {
    const audit = makeAuditStub();
    const responses: ReadonlyArray<readonly unknown[]> = [
      [{ ok: 1 }], // capability present
      [{ id: ROLE }], // role lookup
      [
        {
          id: MEMBERSHIP,
          workspace_id: WS,
          user_id: TARGET,
          role_id: ROLE,
          role_name: "researcher",
          created_at: new Date("2026-05-09T00:00:00Z"),
        },
      ], // existing membership found — short-circuits
    ];
    const stub = makePool({ responsesPerBegin: responses });
    stub.rollback.value = false;

    const svc = new WorkspaceService({
      pool: stub.pool,
      auditLogger: audit.logger,
    });

    const out = await svc.addMember({
      workspaceId: WS,
      targetUserId: TARGET,
      roleName: "researcher",
      actorUserId: ACTOR,
      requestId: "req-3",
    });

    expect(out.id).toBe(MEMBERSHIP);
    // No-op idempotent path: no audit row fires.
    expect(audit.calls).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // changeMemberRole
  // -----------------------------------------------------------------

  it("changeMemberRole: tx rollback at commit emits ZERO audit writes", async () => {
    const audit = makeAuditStub();
    const responses: ReadonlyArray<readonly unknown[]> = [
      [{ ok: 1 }], // assertCan...
      [{ id: NEW_ROLE }], // resolve newRoleName
      [
        {
          id: MEMBERSHIP,
          role_id: ROLE,
          role_name: "researcher",
        },
      ], // existing membership
      [
        {
          id: MEMBERSHIP,
          workspace_id: WS,
          user_id: TARGET,
          role_id: NEW_ROLE,
          created_at: new Date("2026-05-09T00:00:00Z"),
        },
      ], // UPDATE membership RETURNING
      [], // INSERT membership_events
    ];
    const stub = makePool({ responsesPerBegin: responses });
    stub.rollback.value = true;

    const svc = new WorkspaceService({
      pool: stub.pool,
      auditLogger: audit.logger,
    });

    await expect(
      svc.changeMemberRole({
        workspaceId: WS,
        targetUserId: TARGET,
        newRoleName: "admin",
        actorUserId: ACTOR,
        requestId: "req-4",
      }),
    ).rejects.toThrow(/rollback/i);

    expect(stub.callbackResolved.value).toBe(true);
    expect(audit.calls).toHaveLength(0);
  });
});

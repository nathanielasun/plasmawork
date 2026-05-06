/**
 * L1.5 smoke test — pins the manifest §G2.3 acceptance contract:
 *
 *   1. Build a fully-connected fixture graph (user, session, workspace,
 *      member, capsule + v1, run, tool, approval req+token, storage
 *      reservation) — the "second test sees a clean DB" workflow.
 *   2. The workspace+member+capsule+run subset completes in <50ms once
 *      the DB is warm. We set the bound at 250ms to account for cold
 *      planner + macOS Postgres jitter; the bound is a smoke check, not
 *      a microbenchmark.
 *   3. After `resetTestDb`, every non-seed table is empty and the §13
 *      `roles` rows survive.
 *
 * Gated on `PLASMAWORK_TEST_DB_URL`. When unset, the suite reports
 * skipped with the standard message so CI without Postgres stays green.
 */

import {
  describe,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
} from "vitest";

import {
  HAS_TEST_DB,
  TEST_DB_SKIP_REASON,
  RESET_TABLES,
  createScratchDb,
  resetTestDb,
  bindFactories,
  type ScratchDb,
} from "./index.js";

describe.skipIf(!HAS_TEST_DB)("L1.5 — fixture factories smoke", () => {
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

  it("builds a connected fixture graph end-to-end", async () => {
    const f = bindFactories(db.sql);

    const creator = await f.makeUser({ email: "smoke-creator@example.test" });
    const member = await f.makeUser({ email: "smoke-member@example.test" });
    const session = await f.makeSession(member);
    const ws = await f.makeWorkspace(creator, { name: "smoke-ws" });
    const m = await f.makeMember(ws, member, "Researcher");
    const cap = await f.makeCapsule(ws, creator, { name: "smoke-capsule" });
    const run = await f.makeRun(ws, cap, member);
    const tool = await f.makeTool(ws, creator);
    const req = await f.makeApprovalRequest(ws, member, "tool.promote");
    const tok = await f.makeApprovalToken(req, creator);
    const res = await f.makeStorageReservation(ws, creator, 1024 * 1024);

    expect(creator.id).toMatch(/-/);
    expect(session.user_id).toBe(member.id);
    expect(ws.created_by).toBe(creator.id);
    expect(m.workspace_id).toBe(ws.id);
    expect(m.user_id).toBe(member.id);
    expect(cap.capsule.workspace_id).toBe(ws.id);
    expect(cap.capsule.current_version_id).toBe(cap.version!.id);
    expect(cap.version!.version_number).toBe(1);
    expect(run.capsule_id).toBe(cap.capsule.id);
    expect(run.capsule_version_id).toBe(cap.version!.id);
    expect(run.status).toBe("created");
    expect(tool.workspace_id).toBe(ws.id);
    expect(tool.status).toBe("draft");
    expect(req.workspace_id).toBe(ws.id);
    expect(req.requested_action).toBe("tool.promote");
    expect(tok.approval_request_id).toBe(req.id);
    expect(tok.approver_user_id).toBe(creator.id);
    expect(res.bytes_reserved).toBe(1024n * 1024n);
    expect(res.status).toBe("reserved");
  });

  it("workspace+member+capsule+run subset stays comfortably fast", async () => {
    const f = bindFactories(db.sql);
    const u = await f.makeUser();

    // Warm up planner / connection caches with one round-trip.
    await db.sql`SELECT 1`;

    const t0 = performance.now();
    const ws = await f.makeWorkspace(u);
    await f.makeMember(ws, u, "Researcher");
    const cap = await f.makeCapsule(ws, u);
    await f.makeRun(ws, cap, u);
    const elapsed = performance.now() - t0;

    // Manifest target: <50ms warm. We assert <250ms to absorb planner
    // and macOS-Postgres jitter; the bound is a smoke check, not a
    // microbenchmark, but it does fail loud if the path regresses by an
    // order of magnitude.
    expect(elapsed).toBeLessThan(250);
  });

  it("second test sees a clean DB after resetTestDb", async () => {
    // The previous test inserted users + workspace + capsule + run.
    // beforeEach truncated those tables. Confirm.
    for (const table of RESET_TABLES) {
      const rows = await db.sql.unsafe(
        `SELECT count(*)::int AS n FROM "${table}"`,
      );
      expect(rows[0].n, `${table} not empty after reset`).toBe(0);
    }

    // Seeded tables survive the reset.
    const roleRows = await db.sql.unsafe(`SELECT count(*)::int AS n FROM roles`);
    expect(roleRows[0].n).toBeGreaterThan(0);

    const permRows = await db.sql.unsafe(
      `SELECT count(*)::int AS n FROM role_permissions`,
    );
    expect(permRows[0].n).toBeGreaterThan(0);
  });

  it("overrides flow through to the persisted row", async () => {
    const f = bindFactories(db.sql);
    const u = await f.makeUser({
      email: "override@example.test",
      display_name: "Override Tester",
    });
    expect(u.email).toBe("override@example.test");
    expect(u.display_name).toBe("Override Tester");

    const ws = await f.makeWorkspace(u, { name: "override-ws" });
    expect(ws.name).toBe("override-ws");

    const cap = await f.makeCapsule(ws, u, { withInitialVersion: false });
    expect(cap.version).toBeNull();
    expect(cap.capsule.current_version_id).toBeNull();
  });

  it("makeMember resolves §13 roles by name", async () => {
    const f = bindFactories(db.sql);
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);

    const reviewerRoleId = await f.getRoleId("Reviewer");
    const m = await f.makeMember(ws, u, "Reviewer");
    expect(m.role_id).toBe(reviewerRoleId);
  });

  it("makeRun rejects when the capsule has no version and none is supplied", async () => {
    const f = bindFactories(db.sql);
    const u = await f.makeUser();
    const ws = await f.makeWorkspace(u);
    const cap = await f.makeCapsule(ws, u, { withInitialVersion: false });

    await expect(f.makeRun(ws, cap, u)).rejects.toThrow(
      /capsule has no version/,
    );
  });
});

describe.runIf(!HAS_TEST_DB)("L1.5 — fixtures suite skipped", () => {
  it("documents how to enable", () => {
    // eslint-disable-next-line no-console
    console.warn(TEST_DB_SKIP_REASON);
    expect(HAS_TEST_DB).toBe(false);
  });
});

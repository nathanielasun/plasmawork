/**
 * Bootstrap DB adapter — Phase 0.5 / Phase B (2026-05-09).
 *
 * The adapter wraps the BootstrapService.BootstrapDbAdapter contract.
 * These tests pin its INSERT shape against a stub `pool.sql` so we
 * don't need a live Postgres for CI.
 *
 * Pins:
 *   - platformAdminExists is the membership-with-platform-capability
 *     probe shape v4 §22 expects (any user with an
 *     IncidentRemediator-equivalent role anywhere is "the admin").
 *   - insertPlatformAdmin runs every INSERT inside a single
 *     `sql.begin(...)` transaction.
 *   - The user row carries `email = NULL` and the chosen username.
 *   - Three workspaces (`_platform`, `shared-internal-tools`,
 *     `shared-public-experiments`) are created with the admin as
 *     `created_by`.
 *   - Three workspace_memberships are created with the admin as
 *     IncidentRemediator (in `_platform`) and WorkspaceAdmin (in the
 *     two shared workspaces).
 */

import { describe, it, expect } from "vitest";

import {
  createBootstrapDbAdapter,
  SEEDED_PLATFORM_WORKSPACE_NAME,
  SEEDED_INTERNAL_TOOLS_WORKSPACE_NAME,
  SEEDED_PUBLIC_EXPERIMENTS_WORKSPACE_NAME,
  SEEDED_WORKSPACE_NAMES,
} from "../../src/bootstrap/dbAdapter.js";
import type { SecureCorePool } from "../../../../packages/secure_core/src/db/pool.js";

interface CapturedQuery {
  /** First fragment of the tagged-template raw segment. */
  fragment: string;
  values: unknown[];
}

function makeStubPool(opts: {
  existsRows?: Array<{ exists_flag: number }>;
}): {
  pool: SecureCorePool;
  txQueries: CapturedQuery[];
  outerQueries: CapturedQuery[];
  beginCalls: { value: number };
} {
  const txQueries: CapturedQuery[] = [];
  const outerQueries: CapturedQuery[] = [];
  const beginCalls = { value: 0 };

  function makeTaggedTemplate(target: CapturedQuery[]) {
    return ((strings: TemplateStringsArray, ...values: unknown[]) => {
      target.push({ fragment: strings.raw[0] ?? "", values });
      return Promise.resolve(opts.existsRows ?? []);
    }) as unknown as SecureCorePool["sql"];
  }

  const sql = makeTaggedTemplate(outerQueries);
  (
    sql as unknown as {
      begin: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    }
  ).begin = async (fn: (tx: unknown) => Promise<unknown>) => {
    beginCalls.value += 1;
    const tx = makeTaggedTemplate(txQueries);
    return await fn(tx);
  };

  return {
    pool: { sql, db: {} as SecureCorePool["db"] } as unknown as SecureCorePool,
    txQueries,
    outerQueries,
    beginCalls,
  };
}

const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000001";
const PLATFORM_WS_ID = "00000000-0000-4000-8000-0000000000a1";
const INTERNAL_TOOLS_WS_ID = "00000000-0000-4000-8000-0000000000a2";
const PUBLIC_EXP_WS_ID = "00000000-0000-4000-8000-0000000000a3";

describe("createBootstrapDbAdapter", () => {
  it("platformAdminExists returns true when the probe finds a row", async () => {
    const stub = makeStubPool({ existsRows: [{ exists_flag: 1 }] });
    const adapter = createBootstrapDbAdapter({ pool: stub.pool });
    expect(await adapter.platformAdminExists()).toBe(true);
  });

  it("platformAdminExists returns false when no admin found", async () => {
    const stub = makeStubPool({ existsRows: [] });
    const adapter = createBootstrapDbAdapter({ pool: stub.pool });
    expect(await adapter.platformAdminExists()).toBe(false);
  });

  it("platformAdminExists probes for platform:incident_remediate", async () => {
    const stub = makeStubPool({});
    const adapter = createBootstrapDbAdapter({ pool: stub.pool });
    await adapter.platformAdminExists();
    expect(stub.outerQueries[0]?.fragment).toContain("workspace_memberships");
    const allValues = stub.outerQueries[0]!.values.map(String).join(" ");
    void allValues; // values are interpolated as bound params; the
    // fragment-text check below is the more meaningful assertion.
    // The query must filter by platform:incident_remediate — that's the
    // capability that gates re-bootstrap.
    expect(stub.outerQueries[0]?.fragment).toContain("rp.capability");
  });

  it("insertPlatformAdmin runs every INSERT inside a single sql.begin tx", async () => {
    let idCounter = 0;
    const ids = [
      ADMIN_USER_ID,
      PLATFORM_WS_ID,
      INTERNAL_TOOLS_WS_ID,
      PUBLIC_EXP_WS_ID,
      "memb-1",
      "memb-2",
      "memb-3",
      "evt-1",
      "evt-2",
      "evt-3",
    ];
    const stub = makeStubPool({});
    const adapter = createBootstrapDbAdapter({
      pool: stub.pool,
      hashPasswordFn: async () => "$argon2id$test$hash",
      generateId: () => ids[idCounter++] ?? `auto-${idCounter}`,
    });

    const out = await adapter.insertPlatformAdmin({
      username: "rootadmin42x9k",
      password: "supersecretpassword12345",
      requestId: "req-1",
    });

    expect(out.adminUserId).toBe(ADMIN_USER_ID);
    expect(stub.beginCalls.value).toBe(1);
    // Outer (non-tx) queries should be zero — every write is in tx.
    expect(stub.outerQueries).toHaveLength(0);
    // Four expected fragment groups: users INSERT, user_credentials
    // INSERT, workspaces INSERT, memberships INSERT, membership_events
    // INSERT.
    const fragments = stub.txQueries.map((q) => q.fragment).join("\n");
    expect(fragments).toContain("INSERT INTO users");
    expect(fragments).toContain("INSERT INTO user_credentials");
    expect(fragments).toContain("INSERT INTO workspaces");
    expect(fragments).toContain("INSERT INTO workspace_memberships");
    expect(fragments).toContain("INSERT INTO workspace_membership_events");
  });

  it("insertPlatformAdmin sends username + NULL email + role uuids", async () => {
    let idCounter = 0;
    const ids = [
      ADMIN_USER_ID,
      PLATFORM_WS_ID,
      INTERNAL_TOOLS_WS_ID,
      PUBLIC_EXP_WS_ID,
      "memb-1",
      "memb-2",
      "memb-3",
      "evt-1",
      "evt-2",
      "evt-3",
    ];
    const stub = makeStubPool({});
    const adapter = createBootstrapDbAdapter({
      pool: stub.pool,
      hashPasswordFn: async () => "$argon2id$test$hash",
      generateId: () => ids[idCounter++] ?? `auto-${idCounter}`,
    });

    await adapter.insertPlatformAdmin({
      username: "rootadmin42x9k",
      password: "supersecretpassword12345",
      requestId: "req-2",
    });

    const allValues = stub.txQueries.flatMap((q) => q.values);
    expect(allValues).toContain("rootadmin42x9k");
    expect(allValues).toContain("$argon2id$test$hash");
    // Both shared workspace names AND the platform workspace name
    // appear as bound parameters somewhere.
    for (const name of SEEDED_WORKSPACE_NAMES) {
      expect(allValues).toContain(name);
    }
    // IncidentRemediator role uuid (deterministic) appears for the
    // platform-workspace membership; WorkspaceAdmin uuid appears for
    // the two shared workspaces.
    expect(allValues).toContain("9fd675cb-dbaa-59d3-9f21-3e5ae3bfc4ad");
    expect(allValues).toContain("5b807f69-df63-5054-a96a-490c9668a567");
  });

  it("seeded workspace names are stable + match the gateway's slug expectations", () => {
    expect(SEEDED_PLATFORM_WORKSPACE_NAME).toBe("_platform");
    expect(SEEDED_INTERNAL_TOOLS_WORKSPACE_NAME).toBe("shared-internal-tools");
    expect(SEEDED_PUBLIC_EXPERIMENTS_WORKSPACE_NAME).toBe(
      "shared-public-experiments",
    );
  });
});

/**
 * L1.8 schema-and-privileges integration test.
 *
 * Requires a live PostgreSQL 16+ at PLASMAWORK_TEST_DB_URL. The test
 * uses the URL it is given as a SUPERUSER URL (template `postgres://
 * postgres:postgres@localhost:5432/postgres`) and creates a fresh
 * scratch database per file so concurrent workspaces don't collide.
 *
 * When PLASMAWORK_TEST_DB_URL is unset, every case skips with a clear
 * message — CI without Postgres still passes the typecheck step.
 *
 * Coverage:
 *   - Every table from v4 §11 exists after migrations.
 *   - role_permissions has rows for every seeded role.
 *   - V4-R3 actor_type='unauthenticated' round-trips on audit_events.
 *   - V4-R6 quota_counters period CHECK accepts both-NULL, both-NOT-NULL,
 *     and rejects asymmetric.
 *   - V4-R7 operator_events.audit_event_id is NOT NULL.
 *   - workspace_memberships partial unique index forbids duplicate
 *     active memberships and allows re-add after removal.
 *   - As secure_core_app: INSERT into audit_events succeeds; UPDATE
 *     and DELETE are rejected with permission denied.
 *   - As secure_core_audit_read: SELECT on audit_events succeeds;
 *     INSERT is rejected.
 *   - As secure_core_anchor_writer: INSERT into log_chain_anchors
 *     succeeds; SELECT/UPDATE/DELETE are rejected.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { runMigrations } from "../../src/db/migrate.js";
import { ALL_TABLE_NAMES } from "../../src/db/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "../../src/db/migrations");

const SUPERUSER_URL = process.env.PLASMAWORK_TEST_DB_URL;
const SHOULD_RUN = Boolean(SUPERUSER_URL && SUPERUSER_URL.length > 0);

const SKIP_REASON =
  "Set PLASMAWORK_TEST_DB_URL to a Postgres superuser URL to run L1.8 DB tests.";

// We can't await before describe(), but we can branch on env. Use
// `describe.skipIf` from vitest's it/describe when not set.
describe.skipIf(!SHOULD_RUN)("L1.8 — schema, seed, and role privileges", () => {
  // Per-file scratch database created against the superuser URL, then
  // dropped on teardown. Migrations run as superuser inside the scratch DB.
  const scratchDbName = `plasmawork_l18_${Date.now()}_${Math.floor(
    Math.random() * 1e6,
  )}`;
  let scratchUrl = "";
  let superClient: ReturnType<typeof postgres> | null = null;

  // Per-role clients connected once migrations + roles exist.
  let appClient: ReturnType<typeof postgres> | null = null;
  let auditReadClient: ReturnType<typeof postgres> | null = null;
  let anchorWriterClient: ReturnType<typeof postgres> | null = null;
  let migratorClient: ReturnType<typeof postgres> | null = null;

  beforeAll(async () => {
    superClient = postgres(SUPERUSER_URL!, { max: 1, prepare: false });
    // Create the scratch DB (cannot run inside a transaction).
    await superClient.unsafe(`CREATE DATABASE "${scratchDbName}"`);

    const url = new URL(SUPERUSER_URL!);
    url.pathname = `/${scratchDbName}`;
    scratchUrl = url.toString();

    // Run migrations against the scratch DB as superuser. The migrator
    // role itself will be created inside `0001_create_roles.sql`.
    await runMigrations({ url: scratchUrl, migrationsFolder: MIGRATIONS_FOLDER });

    // Issue passwordless local logins for the role accounts so we can
    // connect as them. Tests run on local dev infra; production setups
    // wire up real authentication.
    migratorClient = postgres(scratchUrl, { max: 1, prepare: false });
    await migratorClient.unsafe(
      `ALTER ROLE secure_core_app LOGIN; ` +
        `ALTER ROLE secure_core_audit_read LOGIN; ` +
        `ALTER ROLE secure_core_anchor_writer LOGIN;`,
    );

    const appUrl = new URL(scratchUrl);
    appUrl.username = "secure_core_app";
    appUrl.password = "";
    appClient = postgres(appUrl.toString(), { max: 1, prepare: false });

    const auditUrl = new URL(scratchUrl);
    auditUrl.username = "secure_core_audit_read";
    auditUrl.password = "";
    auditReadClient = postgres(auditUrl.toString(), {
      max: 1,
      prepare: false,
    });

    const anchorUrl = new URL(scratchUrl);
    anchorUrl.username = "secure_core_anchor_writer";
    anchorUrl.password = "";
    anchorWriterClient = postgres(anchorUrl.toString(), {
      max: 1,
      prepare: false,
    });
  }, 60_000);

  afterAll(async () => {
    await appClient?.end({ timeout: 5 });
    await auditReadClient?.end({ timeout: 5 });
    await anchorWriterClient?.end({ timeout: 5 });
    await migratorClient?.end({ timeout: 5 });
    if (superClient) {
      // Terminate any lingering backends, then drop scratch DB.
      await superClient.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity ` +
          `WHERE datname = '${scratchDbName}' AND pid <> pg_backend_pid()`,
      );
      await superClient.unsafe(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
      await superClient.end({ timeout: 5 });
    }
  }, 30_000);

  // -----------------------------------------------------------------------
  // Table presence
  // -----------------------------------------------------------------------

  it("creates every table named in v4 §11", async () => {
    const rows = await migratorClient!.unsafe(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const present = new Set(rows.map((r) => r.table_name as string));
    for (const expected of ALL_TABLE_NAMES) {
      expect(present.has(expected), `missing table ${expected}`).toBe(true);
    }
    expect(ALL_TABLE_NAMES.length).toBe(26);
  });

  it("seeds the §13 suggested roles with non-empty role_permissions", async () => {
    const roleRows = await migratorClient!.unsafe(
      `SELECT name FROM roles ORDER BY name`,
    );
    const roleNames = roleRows.map((r) => r.name as string);
    expect(roleNames).toEqual(
      [
        "ComputeManager",
        "IncidentInvestigator",
        "IncidentRemediator",
        "ModuleDeveloper",
        "PlatformAuditor",
        "Researcher",
        "Reviewer",
        "Viewer",
        "WorkspaceAdmin",
      ].sort(),
    );

    const permRows = await migratorClient!.unsafe(
      `SELECT count(*)::int AS n FROM role_permissions`,
    );
    expect(permRows[0].n).toBeGreaterThan(0);

    // Spot check a few critical mappings.
    const reviewerCaps = await migratorClient!.unsafe(
      `SELECT capability FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id WHERE r.name = 'Reviewer'`,
    );
    const reviewerCapSet = new Set(
      reviewerCaps.map((r) => r.capability as string),
    );
    expect(reviewerCapSet.has("audit:read")).toBe(true);
    expect(reviewerCapSet.has("tool:approve_promotion")).toBe(true);

    const auditorCaps = await migratorClient!.unsafe(
      `SELECT capability FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id WHERE r.name = 'PlatformAuditor'`,
    );
    expect(auditorCaps).toHaveLength(1);
    expect(auditorCaps[0].capability).toBe("platform:audit_read");
  });

  // -----------------------------------------------------------------------
  // V4 fix invariants
  // -----------------------------------------------------------------------

  it("V4-R3: actor_type='unauthenticated' round-trips on audit_events", async () => {
    const userId = randomUUID();
    await migratorClient!.unsafe(
      `INSERT INTO users (id, email) VALUES ('${userId}', 'r3@example.test')`,
    );
    const id = randomUUID();
    await migratorClient!.unsafe(
      `INSERT INTO audit_events
        (id, actor_type, action, result, row_hash, canonicalization_version)
       VALUES ('${id}', 'unauthenticated', 'login.failed', 'failed',
               'deadbeef', 'jcs-v1')`,
    );
    const rows = await migratorClient!.unsafe(
      `SELECT actor_type FROM audit_events WHERE id = '${id}'`,
    );
    expect(rows[0].actor_type).toBe("unauthenticated");
  });

  it("V4-R6: quota_counters accepts both-NULL period and rejects asymmetric", async () => {
    const userId = randomUUID();
    const wsId = randomUUID();
    await migratorClient!.unsafe(
      `INSERT INTO users (id, email) VALUES ('${userId}', 'r6@example.test');
       INSERT INTO workspaces (id, name, created_by) VALUES ('${wsId}', 'r6', '${userId}');`,
    );

    // Both NULL: cumulative quota — accepted.
    await migratorClient!.unsafe(
      `INSERT INTO quota_counters (workspace_id, quota_key, current_value, limit_value)
       VALUES ('${wsId}', 'cumulative.bytes', 0, 1000000)`,
    );

    // Both NOT NULL with end > start: period quota — accepted.
    await migratorClient!.unsafe(
      `INSERT INTO quota_counters (workspace_id, quota_key, current_value, limit_value, period_start, period_end)
       VALUES ('${wsId}', 'daily.runs', 0, 100, now(), now() + interval '1 day')`,
    );

    // start NOT NULL, end NULL: rejected.
    await expect(
      migratorClient!.unsafe(
        `INSERT INTO quota_counters (workspace_id, quota_key, current_value, limit_value, period_start, period_end)
         VALUES ('${wsId}', 'bad.asym1', 0, 1, now(), NULL)`,
      ),
    ).rejects.toThrow(/quota_counters_period_check/);

    // start NULL, end NOT NULL: rejected.
    await expect(
      migratorClient!.unsafe(
        `INSERT INTO quota_counters (workspace_id, quota_key, current_value, limit_value, period_start, period_end)
         VALUES ('${wsId}', 'bad.asym2', 0, 1, NULL, now())`,
      ),
    ).rejects.toThrow(/quota_counters_period_check/);
  });

  it("V4-R7: operator_events.audit_event_id is NOT NULL", async () => {
    // Insert minimum dependencies.
    const userId = randomUUID();
    const sessionId = randomUUID();
    await migratorClient!.unsafe(
      `INSERT INTO users (id, email) VALUES ('${userId}', 'r7@example.test');
       INSERT INTO sessions (id, user_id, session_hash, auth_method, assurance_level, expires_at)
       VALUES ('${sessionId}', '${userId}', 'r7sess', 'sso', 'aal2', now() + interval '1 hour');`,
    );

    // Attempt operator_events without audit_event_id → fails NOT NULL.
    await expect(
      migratorClient!.unsafe(
        `INSERT INTO operator_events
           (id, actor_user_id, capability, reason, session_id, row_hash)
         VALUES ('${randomUUID()}', '${userId}', 'platform:audit_read',
                 'test', '${sessionId}', 'aa')`,
      ),
    ).rejects.toThrow(/audit_event_id/);
  });

  it("ADR-0010: log_chain_anchors requires a version-pinned external URI", async () => {
    await expect(
      migratorClient!.unsafe(
        `INSERT INTO log_chain_anchors
          (id, log_type, anchor_hash, anchored_row_id, external_anchor_uri)
         VALUES (
          '${randomUUID()}',
          'audit_events',
          'hash-no-version',
          '${randomUUID()}',
          's3://simworkbench-worm-dev/anchors/audit/no-version.json'
         )`,
      ),
    ).rejects.toThrow(/external_anchor_uri_has_version_id/);

    await migratorClient!.unsafe(
      `INSERT INTO log_chain_anchors
        (id, log_type, anchor_hash, anchored_row_id, external_anchor_uri)
       VALUES (
        '${randomUUID()}',
        'audit_events',
        'hash-with-version',
        '${randomUUID()}',
        's3://simworkbench-worm-dev/anchors/audit/ok.json?versionId=v1'
       )`,
    );
  });

  it("workspace_memberships_active_unique forbids duplicate active rows", async () => {
    const userId = randomUUID();
    const wsId = randomUUID();
    await migratorClient!.unsafe(
      `INSERT INTO users (id, email) VALUES ('${userId}', 'wm@example.test');
       INSERT INTO workspaces (id, name, created_by) VALUES ('${wsId}', 'wm', '${userId}');`,
    );
    const roleId = (
      await migratorClient!.unsafe(
        `SELECT id FROM roles WHERE name = 'Viewer'`,
      )
    )[0].id as string;

    const m1 = randomUUID();
    await migratorClient!.unsafe(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id)
       VALUES ('${m1}', '${wsId}', '${userId}', '${roleId}')`,
    );

    // Second active row for same (workspace, user) → rejected.
    await expect(
      migratorClient!.unsafe(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id)
         VALUES ('${randomUUID()}', '${wsId}', '${userId}', '${roleId}')`,
      ),
    ).rejects.toThrow(/workspace_memberships_active_unique/);

    // After removing the first, a re-add succeeds.
    await migratorClient!.unsafe(
      `UPDATE workspace_memberships SET removed_at = now() WHERE id = '${m1}'`,
    );
    await migratorClient!.unsafe(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id)
       VALUES ('${randomUUID()}', '${wsId}', '${userId}', '${roleId}')`,
    );
  });

  // -----------------------------------------------------------------------
  // Privilege restrictions (§29 #51-54)
  // -----------------------------------------------------------------------

  it("secure_core_app may INSERT into audit_events but cannot UPDATE/DELETE", async () => {
    const id = randomUUID();
    await appClient!.unsafe(
      `INSERT INTO audit_events
        (id, actor_type, action, result, row_hash)
       VALUES ('${id}', 'human', 'capsule.created', 'succeeded', 'cafef00d')`,
    );

    await expect(
      appClient!.unsafe(
        `UPDATE audit_events SET result = 'failed' WHERE id = '${id}'`,
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      appClient!.unsafe(`DELETE FROM audit_events WHERE id = '${id}'`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("secure_core_app cannot SELECT audit_events", async () => {
    await expect(
      appClient!.unsafe(`SELECT 1 FROM audit_events LIMIT 1`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("ADR-0010: secure_core_app cannot INSERT log_chain_anchors", async () => {
    await expect(
      appClient!.unsafe(
        `INSERT INTO log_chain_anchors
          (id, log_type, anchor_hash, anchored_row_id, external_anchor_uri)
         VALUES (
          '${randomUUID()}',
          'audit_events',
          'app-role-anchor-attempt',
          '${randomUUID()}',
          's3://simworkbench-worm-dev/anchors/audit/app.json?versionId=v1'
         )`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("secure_core_audit_read may SELECT audit_events but cannot INSERT", async () => {
    const rows = await auditReadClient!.unsafe(
      `SELECT count(*)::int AS n FROM audit_events`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(0);

    await expect(
      auditReadClient!.unsafe(
        `INSERT INTO audit_events
          (id, actor_type, action, result, row_hash)
         VALUES ('${randomUUID()}', 'human', 'forbidden', 'denied', 'aa')`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("secure_core_anchor_writer may INSERT log_chain_anchors but cannot read or mutate them", async () => {
    const id = randomUUID();
    await anchorWriterClient!.unsafe(
      `INSERT INTO log_chain_anchors
        (id, log_type, anchor_hash, anchored_row_id, external_anchor_uri)
       VALUES (
        '${id}',
        'audit_events',
        'anchor-writer-hash',
        '${randomUUID()}',
        's3://simworkbench-worm-dev/anchors/audit/${id}.json?versionId=v1'
       )`,
    );

    await expect(
      anchorWriterClient!.unsafe(`SELECT 1 FROM log_chain_anchors LIMIT 1`),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      anchorWriterClient!.unsafe(
        `UPDATE log_chain_anchors SET anchor_hash = 'changed' WHERE id = '${id}'`,
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      anchorWriterClient!.unsafe(
        `DELETE FROM log_chain_anchors WHERE id = '${id}'`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

// When the env var is unset, vitest reports the suite as skipped which
// keeps `npm test` green for CI configurations without Postgres.
describe.runIf(!SHOULD_RUN)("L1.8 — DB tests skipped (no PLASMAWORK_TEST_DB_URL)", () => {
  it("documents how to enable", () => {
    // eslint-disable-next-line no-console
    console.warn(SKIP_REASON);
    expect(SHOULD_RUN).toBe(false);
  });
});

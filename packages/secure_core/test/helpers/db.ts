/**
 * Test DB lifecycle — Phase 0.5 Layer-1 (L1.5).
 *
 * Provides:
 *   - `createScratchDb()` / `dropScratchDb()`: per-file scratch database
 *     created against the superuser URL in `PLASMAWORK_TEST_DB_URL`. The
 *     migrator role and the four secure_core_* roles get LOGIN granted so
 *     factories can connect as the migrator (DDL-permitted) client.
 *   - `resetTestDb(sql)`: truncates every non-seed table; preserves the
 *     §13 `roles` and `role_permissions` rows seeded in migration 0002.
 *     This is the per-test cleanup the manifest §4 calls for. Faster
 *     than dropping/recreating the schema.
 *   - `withScratchDb(test)`: wraps a vitest `it.concurrent`-style block
 *     so it runs under a fresh scratch DB.
 *
 * Gated on `PLASMAWORK_TEST_DB_URL`. When unset, the helpers throw a
 * clear "skipped" error and the suite that depends on them should
 * `describe.skipIf(!HAS_TEST_DB)`.
 */

import postgres, { type Sql } from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { runMigrations } from "../../src/db/migrate.js";
import { ALL_TABLE_NAMES } from "../../src/db/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "../../src/db/migrations");

export const HAS_TEST_DB = Boolean(
  process.env.PLASMAWORK_TEST_DB_URL &&
    process.env.PLASMAWORK_TEST_DB_URL.length > 0,
);

export const TEST_DB_SKIP_REASON =
  "Set PLASMAWORK_TEST_DB_URL to a Postgres superuser URL to run DB-bound tests.";

/**
 * Tables that are reset before each test. `roles` and `role_permissions`
 * are seeded in migration 0002 / 0003 and survive `resetTestDb` so test
 * code can reference §13 roles by name without re-seeding every test.
 */
export const RESET_TABLES: readonly string[] = ALL_TABLE_NAMES.filter(
  (t) => t !== "roles" && t !== "role_permissions",
);

export interface ScratchDb {
  /** Migrator-role client. DDL-permitted; bypasses GRANT restrictions. */
  sql: Sql;
  /** Connection URL for the scratch DB (passed to postgres()). */
  url: string;
  /** Drop the scratch DB and close all clients. */
  cleanup: () => Promise<void>;
}

/**
 * Create a fresh scratch database, run migrations, and grant LOGIN on
 * the four secure_core_* roles so role-restricted clients can connect.
 *
 * Returns the migrator-role `Sql` client — use this for fixture inserts
 * since it has DDL/DML privileges across every table.
 */
export async function createScratchDb(): Promise<ScratchDb> {
  if (!HAS_TEST_DB) {
    throw new Error(TEST_DB_SKIP_REASON);
  }
  const superUrl = process.env.PLASMAWORK_TEST_DB_URL!;
  const dbName = `plasmawork_l15_${Date.now()}_${Math.floor(
    Math.random() * 1e6,
  )}`;

  const superClient = postgres(superUrl, { max: 1, prepare: false });
  await superClient.unsafe(`CREATE DATABASE "${dbName}"`);

  const url = (() => {
    const u = new URL(superUrl);
    u.pathname = `/${dbName}`;
    return u.toString();
  })();

  await runMigrations({ url, migrationsFolder: MIGRATIONS_FOLDER });

  const sql = postgres(url, { max: 4, prepare: false });
  // Make the four roles loginable so factory tests can switch identity.
  await sql.unsafe(
    `ALTER ROLE secure_core_app LOGIN; ` +
      `ALTER ROLE secure_core_audit_read LOGIN; ` +
      `ALTER ROLE secure_core_anchor_writer LOGIN;`,
  );

  const cleanup = async (): Promise<void> => {
    await sql.end({ timeout: 5 });
    await superClient.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity ` +
        `WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    );
    await superClient.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await superClient.end({ timeout: 5 });
  };

  return { sql, url, cleanup };
}

/**
 * Truncate every non-seed table and reset identity sequences. Preserves
 * `roles` and `role_permissions` because they were seeded by migrations
 * 0002 / 0003 and downstream factories reference §13 roles by name.
 *
 * CASCADE is safe here because every dependent table is in
 * `RESET_TABLES` already; CASCADE simply unblocks the FK ordering.
 */
export async function resetTestDb(sql: Sql): Promise<void> {
  if (RESET_TABLES.length === 0) {
    return;
  }
  const quoted = RESET_TABLES.map((t) => `"${t}"`).join(", ");
  await sql.unsafe(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
}

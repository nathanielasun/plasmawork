/**
 * Migration CLI — Phase 0.5 Layer-1 (L1.8).
 *
 * Connects as `secure_core_migrator` (URL from
 * `PLASMAWORK_DB_URL_MIGRATOR`, falling back to `PLASMAWORK_DB_URL` for
 * local dev) and runs every SQL migration under
 * `src/db/migrations/`. Drizzle tracks application via the
 * `drizzle.__drizzle_migrations` ledger; running the script twice on a
 * clean DB applies each file exactly once.
 *
 * Usage:
 *   PLASMAWORK_DB_URL_MIGRATOR=postgres://… node dist/db/migrate.js
 *   # or for local dev:
 *   PLASMAWORK_DB_URL=postgres://… tsx src/db/migrate.ts
 *
 * Exits 0 on success; non-zero with a clear message on failure.
 *
 * Audit emission: emits a `db.migration_applied` shape via console.
 * Layer 3 will replace this with `auditLogger.write(...)` once the
 * audit path lands; the shape here matches `src/config/audit_events.ts`
 * so the swap is mechanical.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { readSecureCoreEnv } from "../secrets/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function migratorUrl(): string {
  const url =
    readSecureCoreEnv("PLASMAWORK_DB_URL_MIGRATOR") ??
    readSecureCoreEnv("PLASMAWORK_DB_URL");
  if (!url || url.length === 0) {
    throw new Error(
      "secure_core/migrate: set PLASMAWORK_DB_URL_MIGRATOR (or PLASMAWORK_DB_URL for dev) to a Postgres URL.",
    );
  }
  return url;
}

export async function runMigrations(opts?: {
  url?: string;
  migrationsFolder?: string;
}): Promise<{ applied: number }> {
  const url = opts?.url ?? migratorUrl();
  const migrationsFolder =
    opts?.migrationsFolder ?? resolve(__dirname, "migrations");

  // postgres-js client. `max: 1` because migrations want a single
  // session and Drizzle's migrator manages its own transactions.
  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client);

  let appliedCount = 0;

  try {
    const before = Date.now();
    await migrate(db, { migrationsFolder });
    const elapsedMs = Date.now() - before;

    // We don't currently get a per-file count back from Drizzle's
    // migrate() return value; emit the applied set as a single audit
    // shape with the folder path. Layer 3 audit logger will pull the
    // applied list out of `__drizzle_migrations`.
    appliedCount = 1; // placeholder — count derived from ledger in L3
    process.stdout.write(
      JSON.stringify({
        action: "db.migration_applied",
        result: "succeeded",
        actor_type: "operator",
        metadata: { migrations_folder: migrationsFolder, elapsed_ms: elapsedMs },
      }) + "\n",
    );
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        action: "db.migration_applied",
        result: "failed",
        actor_type: "operator",
        metadata: {
          migrations_folder: migrationsFolder,
          error: err instanceof Error ? err.message : String(err),
        },
      }) + "\n",
    );
    throw err;
  } finally {
    await client.end({ timeout: 5 });
  }

  return { applied: appliedCount };
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);

if (isDirectInvocation) {
  runMigrations().then(
    () => {
      process.exit(0);
    },
    (err) => {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      process.stderr.write(`secure_core/migrate failed:\n${msg}\n`);
      process.exit(1);
    },
  );
}

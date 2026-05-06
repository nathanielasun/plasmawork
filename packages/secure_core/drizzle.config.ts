/**
 * Drizzle Kit configuration — Phase 0.5 Layer-1 (L1.8).
 *
 * Generates SQL migrations from `src/db/schema.ts` into
 * `src/db/migrations/`. The migrator role's URL comes from
 * `PLASMAWORK_DB_URL` (or the more specific
 * `PLASMAWORK_DB_MIGRATOR_URL`); see `src/db/migrate.ts`.
 *
 * ADR-0008 pins Drizzle ORM + PostgreSQL 16+. ORM features beyond
 * Drizzle (Prisma, Kysely, etc.) are out of scope.
 */
import type { Config } from "drizzle-kit";

const url =
  process.env.PLASMAWORK_DB_MIGRATOR_URL ??
  process.env.PLASMAWORK_DB_URL ??
  "postgres://localhost:5432/plasmawork_dev";

export default {
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url },
  // Drizzle's default migration table name is `__drizzle_migrations`.
  // We make it explicit so the convention checker can grep for it.
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  strict: true,
  verbose: true,
} satisfies Config;

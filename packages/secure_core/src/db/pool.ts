/**
 * Role-aware DB connection factory — Phase 0.5 Layer-1 (L1.8).
 *
 * Each application surface that touches the database imports a pool tied
 * to the minimum-privilege role for that surface. The four roles are
 * created in `0001_create_roles.sql`:
 *
 *   secure_core_app           — general application; INSERT/SELECT/UPDATE
 *                               on mutable tables, INSERT-only on log
 *                               tables, NO SELECT on audit tables.
 *   secure_core_audit_read    — audit-read endpoint (after capability
 *                               check): SELECT-only on audit/provenance/
 *                               operator/anchor tables.
 *   secure_core_anchor_writer — external WORM anchor committer: INSERT-only
 *                               on `log_chain_anchors`.
 *   secure_core_migrator      — migrations only; not for runtime traffic.
 *
 * Each role has a dedicated env var holding its connection URL. In dev,
 * a single `PLASMAWORK_DB_URL` falls through for all roles so a one-DB
 * sandbox works without provisioning four logins; production MUST set
 * the four URLs explicitly so the role separation is real.
 *
 * Connection client: `postgres` (postgres-js). This is Drizzle's
 * recommended driver for `drizzle-orm/postgres-js`.
 */

import postgres, { type Sql } from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./schema.js";

export type SecureCoreRole =
  | "app"
  | "audit_read"
  | "anchor_writer"
  | "migrator";

const ROLE_ENV: Record<SecureCoreRole, string> = {
  app: "PLASMAWORK_DB_URL_APP",
  audit_read: "PLASMAWORK_DB_URL_AUDIT_READ",
  anchor_writer: "PLASMAWORK_DB_URL_ANCHOR_WRITER",
  migrator: "PLASMAWORK_DB_URL_MIGRATOR",
};

export interface MakePoolOptions {
  role: SecureCoreRole;
  /** postgres-js `max` connection-pool size. Defaults: 10 (app), 4 (others). */
  poolSize?: number;
}

export interface SecureCorePool {
  role: SecureCoreRole;
  sql: Sql;
  db: PostgresJsDatabase<typeof schema>;
  /** Close the underlying postgres-js client. */
  close(): Promise<void>;
}

function resolveUrl(role: SecureCoreRole): string {
  const specific = process.env[ROLE_ENV[role]];
  if (specific && specific.length > 0) {
    return specific;
  }
  const fallback = process.env.PLASMAWORK_DB_URL;
  if (fallback && fallback.length > 0) {
    // Dev / local-test fallback. Production deployments set the four
    // role-specific URLs and never trigger this branch.
    return fallback;
  }
  throw new Error(
    `secure_core: cannot construct DB pool for role=${role}: ` +
      `set ${ROLE_ENV[role]} (or PLASMAWORK_DB_URL for dev).`,
  );
}

/**
 * Construct a Drizzle-wrapped postgres-js pool bound to a single
 * privilege role. The pool is independent per call — the caller owns
 * lifecycle. Tests get one pool per role for assertion isolation.
 */
export function makePool(options: MakePoolOptions): SecureCorePool {
  const { role } = options;
  const url = resolveUrl(role);
  const max =
    options.poolSize ?? (role === "app" ? 10 : role === "migrator" ? 2 : 4);

  const client = postgres(url, {
    max,
    // Postgres-js pre-converts BIGINT to JS number; force string so
    // values larger than 2^53 survive. App code parses with BigInt().
    types: {
      bigint: postgres.BigInt,
    },
    // Refuse implicit prepared-statement caching across role boundaries;
    // each pool is its own connection and shouldn't share state.
    prepare: false,
  });

  const db = drizzle(client, { schema });

  return {
    role,
    sql: client,
    db,
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}

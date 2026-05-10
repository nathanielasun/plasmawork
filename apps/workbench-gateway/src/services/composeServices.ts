/**
 * Service composition for the workbench-gateway — Phase 0.5 / Phase D
 * (2026-05-09).
 *
 * One job: take the validated `.env.auth` env + the postgres-js
 * clients owned by `main.ts` and instantiate every secure_core service
 * the gateway's route plugins need.
 *
 * Each factory below is a single concern. They are composed in
 * `buildGatewayServices` which `main.ts` calls once at startup. The
 * lifetime of every returned object is tied to the postgres-js clients
 * the caller passes in; this module does NOT own pool lifecycle.
 *
 * Why this lives in the gateway and not in secure_core: the L4 plan
 * intentionally ships secure_core as a library — every service wants
 * pool / audit / argon2 deps the host owns. The gateway is the host;
 * this file is the wiring contract.
 */
import type { Sql } from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../../../packages/secure_core/src/db/schema.js";
import type { SecureCorePool } from "../../../../packages/secure_core/src/db/pool.js";
import { LoginService } from "../../../../packages/secure_core/src/auth/loginService.js";
import { SqlCurrentSessionReader } from "../../../../packages/secure_core/src/auth/sessionService.js";
import {
  AuditLogger,
  AuditDbWriter,
} from "../../../../packages/secure_core/src/audit/index.js";
import { BootstrapService } from "../../../../packages/secure_core/src/bootstrap/service.js";
import {
  FakeWormMarkerProvider,
  S3WormMarkerProvider,
  type BootstrapWormMarkerProvider,
} from "../../../../packages/secure_core/src/bootstrap/wormMarker.js";

import type { GatewayEnv } from "../env.js";
import {
  createArgon2Adapter,
  recordVerificationOutcome,
} from "../auth/argon2Adapter.js";
import { createBootstrapDbAdapter } from "../bootstrap/dbAdapter.js";

/**
 * Resolve the bootstrap WORM marker provider from the env. Audit fix
 * (2026-05-09): the previous default was a process-local
 * ``FakeWormMarkerProvider``, which means a DB restore alone could
 * re-enable bootstrap (the "true" WORM contract per ADR-0010 says
 * the marker MUST survive DB restore). Production deployments now
 * configure ``WORKBENCH_BOOTSTRAP_WORM_PROVIDER=s3`` and provide the
 * S3 bucket / key vars; bootstrap-allowed deployments without an
 * explicit WORM provider fail closed at boot.
 *
 * Modes:
 *   - ``s3`` → ``S3WormMarkerProvider`` (production).
 *   - ``fake`` → ``FakeWormMarkerProvider`` (single-node dev).
 *     Bootstrap-allowed dev installs MUST opt into this explicitly
 *     so a production env that forgets to set the provider fails
 *     instead of silently using the in-memory marker.
 *   - unset → falls back to ``fake`` ONLY when bootstrap is also
 *     disabled (``BOOTSTRAP_ALLOWED`` not ``"1"``); otherwise
 *     throws.
 */
function resolveWormMarkerFromEnv(env: GatewayEnv): BootstrapWormMarkerProvider {
  const provider = (env.bootstrapWormProvider ?? "").toLowerCase();
  if (provider === "s3") {
    if (
      env.bootstrapWormS3Bucket === undefined ||
      env.bootstrapWormS3Key === undefined ||
      env.bootstrapWormS3Region === undefined
    ) {
      throw new Error(
        "composeServices: WORKBENCH_BOOTSTRAP_WORM_PROVIDER=s3 but " +
          "WORKBENCH_BOOTSTRAP_WORM_S3_BUCKET, WORKBENCH_BOOTSTRAP_WORM_S3_KEY, " +
          "or WORKBENCH_BOOTSTRAP_WORM_S3_REGION is missing in .env.auth.",
      );
    }
    return new S3WormMarkerProvider({
      bucket: env.bootstrapWormS3Bucket,
      key: env.bootstrapWormS3Key,
      region: env.bootstrapWormS3Region,
    });
  }
  if (provider === "fake") {
    return new FakeWormMarkerProvider();
  }
  if (env.bootstrapAllowed === "1") {
    throw new Error(
      "composeServices: BOOTSTRAP_ALLOWED=1 but " +
        "WORKBENCH_BOOTSTRAP_WORM_PROVIDER is unset. Refusing to start " +
        "with the in-memory fake provider — a DB restore would silently " +
        "re-enable bootstrap. Set " +
        'WORKBENCH_BOOTSTRAP_WORM_PROVIDER="s3" + the S3 bucket/key/region ' +
        'vars (production), or "fake" + accept the dev-only durability ' +
        "limitation.",
    );
  }
  // Bootstrap is closed AND no provider configured. The route is
  // unreachable in this case, so the marker provider is never queried;
  // a fake instance is fine.
  return new FakeWormMarkerProvider();
}

/**
 * Wrap a raw postgres-js client + an explicit role label as the
 * `SecureCorePool` shape that secure_core services consume. The
 * upstream `makePool` factory reads URLs from
 * `PLASMAWORK_DB_URL_*` env vars; the gateway has already loaded its
 * URLs via `loadGatewayEnv`, so we adapt directly without re-reading
 * env. The `close()` callback is a no-op here — pool lifecycle stays
 * with `main.ts` so a single `await sql.end()` covers every consumer.
 */
function wrapPool(sql: Sql, role: SecureCorePool["role"]): SecureCorePool {
  const db: PostgresJsDatabase<typeof schema> = drizzle(sql, { schema });
  return {
    role,
    sql,
    db,
    async close() {
      // No-op: lifecycle is owned by main.ts. Avoids a double-close
      // when the same `sql` instance is shared across services.
    },
  };
}

export interface BuildGatewayServicesOptions {
  readonly env: GatewayEnv;
  /** App-role postgres-js client. Wraps the `secure_core_app` role pool. */
  readonly appSql: Sql;
  /** Audit-writer postgres-js client. Wraps the audit pool. */
  readonly auditSql: Sql;
  /**
   * WORM marker provider. Production wires the `S3WormMarkerProvider`;
   * dev / single-node uses `FakeWormMarkerProvider` (durable enough
   * for first-boot bootstrap on a developer machine because the route
   * is sealed by the in-DB platform_admin row after success).
   */
  readonly wormMarker?: BootstrapWormMarkerProvider;
}

export interface GatewayServices {
  readonly appPool: SecureCorePool;
  readonly auditPool: SecureCorePool;
  readonly auditLogger: AuditLogger;
  readonly loginService: LoginService;
  readonly sessionReader: SqlCurrentSessionReader;
  readonly bootstrapService: BootstrapService;
  readonly wormMarker: BootstrapWormMarkerProvider;
}

/**
 * Compose every secure_core service the gateway's currently-registered
 * route plugins need (login + session + bootstrap). The proxy plugin
 * (Phase E2) does not consume any of these directly — its dependency
 * is the handoff signer + the appSql for membership lookup.
 */
export function buildGatewayServices(
  opts: BuildGatewayServicesOptions,
): GatewayServices {
  const appPool = wrapPool(opts.appSql, "app");
  const auditPool = wrapPool(opts.auditSql, "app");

  // L1.7 + L3.1: the audit logger writes through the dedicated audit
  // pool. We use logType="audit" — the L1.7 chain for `audit_events`.
  // Provenance + operator chains use the same shape; their loggers
  // attach to higher-layer route plugins (capsules, operator) which
  // are NOT wired in this minimum vertical commit.
  const auditDbWriter = new AuditDbWriter({
    pool: auditPool,
    logType: "audit",
  });
  const auditLogger = new AuditLogger({
    writer: auditDbWriter.writer,
    prevHashGetter: auditDbWriter.prevHashGetter,
  });

  const argon2 = createArgon2Adapter({ pool: appPool });

  const loginService = new LoginService({
    pool: appPool,
    auditLogger,
    verifyPasswordHash: argon2.verifyPasswordHash,
    fetchPasswordHash: argon2.fetchPasswordHash,
    // Audit fix (2026-05-09): wire the per-account counter so
    // ``user_credentials.failed_attempts`` increments on every wrong
    // password and resets on success. Combined with the now-trustable
    // per-IP rate limit (XFF spoofing closed), this gives the
    // documented per-IP + per-account guessing posture.
    recordVerificationOutcome: (userId, success) =>
      recordVerificationOutcome(appPool, userId, success),
  });

  const sessionReader = new SqlCurrentSessionReader({ appPool });

  const bootstrapDb = createBootstrapDbAdapter({ pool: appPool });
  const wormMarker = opts.wormMarker ?? resolveWormMarkerFromEnv(opts.env);
  const bootstrapService = new BootstrapService({
    db: bootstrapDb,
    wormMarker,
    auditLogger,
    credentialHashHex: opts.env.bootstrapCredentialHash,
  });

  return {
    appPool,
    auditPool,
    auditLogger,
    loginService,
    sessionReader,
    bootstrapService,
    wormMarker,
  };
}

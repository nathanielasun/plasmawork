/**
 * Bootstrap service — Phase 0.5 Layer 4 task L4.9.
 *
 * v4 §22.1 — bootstrap requires ALL of:
 *   1. no platform admin exists in live DB,
 *   2. deployment-time flag (`BOOTSTRAP_ALLOWED=1`),
 *   3. out-of-band bootstrap credential (presented at request time,
 *      compared against `BOOTSTRAP_CREDENTIAL_HASH` via constant time),
 *   4. deployment-side WORM marker absent,
 *   5. bootstrap endpoint registered only while all gates pass.
 *
 * After bootstrap:
 *   - DB row records completion (handled by the DB adapter when it
 *     INSERTs the platform-admin user + role assignment),
 *   - WORM marker records completion (provider.recordBootstrap),
 *   - audit event `bootstrap.completed{result:"succeeded"}` emits,
 *   - the next request to /bootstrap fails the gate at the request-time
 *     re-check (the WORM marker is now present), returning 404.
 *
 * Hard rules enforced here:
 *   - The service NEVER reads actor identity from a request body. The
 *     OOB credential is a SECRET (compared via constant time) — it
 *     authenticates the bootstrap request itself, but the audit row
 *     emits with `actorType: 'unauthenticated'` and
 *     `actorUserId: null` because the user the bootstrap creates does
 *     not yet exist when the audit row is prepared. The new user id
 *     lands in the audit metadata, not in `actor_user_id`.
 *   - Every gate MUST execute before the success branch returns. The
 *     OOB credential compare runs unconditionally (even when an
 *     earlier gate already failed) so timing differences don't reveal
 *     which gate fired (V4-R3 anti-enumeration).
 *   - Every attempt — success, denial, or failure — emits exactly one
 *     `bootstrap.completed` audit row.
 *
 * The DB adapter is the seam between this module and the schema. The
 * v4 schema does not currently expose a password column on `users` or
 * a seeded `PlatformAdmin` role; the adapter owns those decisions.
 * This service trusts that:
 *   - `platformAdminExists()` is the authoritative read.
 *   - `insertPlatformAdmin()` is a single transaction that creates the
 *     user row + the platform-admin role assignment + any other rows
 *     v4 §22.1 expects ("DB row records completion").
 *
 * If the WORM marker write fails AFTER the DB insert succeeded, the
 * service propagates the error: the operator must manually inspect
 * because the live DB now contains a platform admin but the marker is
 * absent. v4 §22.1 expects exactly one bootstrap; partial success is
 * recoverable only by an operator with platform-write access.
 */

import { compareTokenConstantTime } from "../crypto/tokens.js";
import type { AuditLogger } from "../audit/logger.js";
import { SecureCoreError } from "../errors/shapes.js";
import type { BootstrapWormMarkerProvider } from "./wormMarker.js";

/**
 * The DB adapter the bootstrap service depends on. Layer-4 wires this
 * to a Drizzle-backed implementation that uses the migrator role's
 * pool (the only role with INSERT privileges on `users` + `roles` +
 * `workspace_memberships`-equivalent platform tables). Tests stub it.
 *
 * `insertPlatformAdmin` runs the full multi-row insert in a single
 * transaction so a partial result cannot leave the DB inconsistent.
 */
export interface BootstrapDbAdapter {
  /**
   * Returns `true` if any user holds the platform-admin role in the
   * live DB. v4 §22.1 gate #1.
   */
  platformAdminExists(): Promise<boolean>;
  /**
   * Inserts the platform-admin user (with the supplied password — the
   * adapter is responsible for hashing per the password contract,
   * never storing plaintext) and the role assignment. Returns the
   * generated user id.
   */
  insertPlatformAdmin(opts: {
    readonly email: string;
    readonly password: string;
    readonly requestId: string;
  }): Promise<{ readonly adminUserId: string }>;
}

export interface BootstrapServiceOptions {
  readonly db: BootstrapDbAdapter;
  readonly wormMarker: BootstrapWormMarkerProvider;
  readonly auditLogger: AuditLogger;
  /**
   * Hex-encoded SHA-256 of the out-of-band bootstrap credential
   * (read from `BOOTSTRAP_CREDENTIAL_HASH` via `secrets/env.ts`).
   * MUST be 64 lowercase hex characters; the secrets layer validates.
   */
  readonly credentialHashHex: string;
}

export interface AttemptBootstrapOptions {
  readonly adminEmail: string;
  readonly adminPassword: string;
  readonly oobCredential: string;
  readonly requestId: string;
}

export interface AttemptBootstrapResult {
  readonly adminUserId: string;
}

/**
 * Generic 403 envelope. Every denial — wrong credential, gate refusal
 * (when the gate is checked at request time AND the route already
 * registered), and any other refusal path — uses the same message.
 * v4 §8 + §22.1 anti-enumeration: a caller cannot tell which gate
 * fired. The plugin maps "endpoint not registered" + "WORM-present at
 * request time" + "admin already exists at request time" to 404 (the
 * `BootstrapGateClosedError` below) and the credential mismatch to
 * 403; both 4xx-message bodies share the same generic copy.
 */
const GENERIC_DENIAL_MESSAGE = "Bootstrap denied.";
const GENERIC_NOT_FOUND_MESSAGE = "Not found.";

/**
 * Thrown when the gate is closed at request time. The plugin maps this
 * to a 404 because §22.1 says the endpoint "registered only while all
 * gates pass" — once any gate fails, the endpoint must look like it
 * was never there.
 */
export class BootstrapGateClosedError extends SecureCoreError {
  public constructor() {
    super("NOT_FOUND", GENERIC_NOT_FOUND_MESSAGE);
  }
}

/**
 * Thrown when the credential mismatches. The plugin maps to 403; v4 §8
 * generic message.
 */
export class BootstrapCredentialMismatchError extends SecureCoreError {
  public constructor() {
    super("PERMISSION_DENIED", GENERIC_DENIAL_MESSAGE);
  }
}

export class BootstrapService {
  readonly #db: BootstrapDbAdapter;
  readonly #wormMarker: BootstrapWormMarkerProvider;
  readonly #auditLogger: AuditLogger;
  readonly #credentialHashHex: string;

  public constructor(opts: BootstrapServiceOptions) {
    if (
      typeof opts.credentialHashHex !== "string" ||
      !/^[0-9a-f]{64}$/.test(opts.credentialHashHex)
    ) {
      throw new Error(
        "BootstrapService: credentialHashHex must be 64 lowercase hex characters (SHA-256 of OOB credential)",
      );
    }
    this.#db = opts.db;
    this.#wormMarker = opts.wormMarker;
    this.#auditLogger = opts.auditLogger;
    this.#credentialHashHex = opts.credentialHashHex;
  }

  /**
   * Attempt a bootstrap. Returns the new admin user id on success,
   * throws `BootstrapGateClosedError` (→ 404) when the WORM marker is
   * present or the platform admin already exists, throws
   * `BootstrapCredentialMismatchError` (→ 403) when the credential
   * mismatches.
   *
   * Order of checks:
   *   1. WORM marker probe.
   *   2. Platform-admin existence probe.
   *   3. OOB credential constant-time compare. ALWAYS runs (even when
   *      gates 1/2 already closed) so timing doesn't leak which gate
   *      fired.
   *   4. AND-of-all-gates decision.
   *
   * On success the order is:
   *   a. INSERT platform-admin (DB transaction).
   *   b. Write WORM marker.
   *   c. Emit `bootstrap.completed{result:"succeeded"}` audit row.
   *
   * If (b) fails AFTER (a) succeeded the function propagates; the
   * audit row in that case still emits a `result:"failed"` so the
   * partial state is observable.
   */
  public async attemptBootstrap(
    opts: AttemptBootstrapOptions,
  ): Promise<AttemptBootstrapResult> {
    // Gate probes — order is (1) WORM, (2) DB. Both run before the
    // credential compare so they share the constant-time fence.
    let wormPresent = true;
    let dbAdminExists = true;
    let probeError: unknown = null;
    try {
      wormPresent = await this.#wormMarker.isBootstrapped();
    } catch (err) {
      probeError = err;
    }
    try {
      dbAdminExists = await this.#db.platformAdminExists();
    } catch (err) {
      probeError ??= err;
    }

    // Constant-time credential compare ALWAYS runs. The result is
    // discarded if any earlier gate already closed; the work is the
    // point — V4-R3 anti-timing.
    const credentialMatches = compareTokenConstantTime(
      opts.oobCredential,
      this.#credentialHashHex,
    );

    // If any probe threw, treat the gate as closed (fail closed) and
    // emit a denied audit row without leaking the underlying cause.
    if (probeError !== null) {
      await this.#emit({
        result: "denied",
        deniedReason: "probe_error",
        requestId: opts.requestId,
      });
      throw new BootstrapGateClosedError();
    }

    // Gate decisions
    const gatesOpen = !wormPresent && !dbAdminExists;
    if (!gatesOpen) {
      await this.#emit({
        result: "denied",
        deniedReason: wormPresent ? "worm_marker_present" : "admin_exists",
        requestId: opts.requestId,
      });
      throw new BootstrapGateClosedError();
    }

    if (!credentialMatches) {
      await this.#emit({
        result: "denied",
        deniedReason: "credential_mismatch",
        requestId: opts.requestId,
      });
      throw new BootstrapCredentialMismatchError();
    }

    // Success path: DB insert, then WORM write, then audit succeed.
    let adminUserId: string;
    try {
      const inserted = await this.#db.insertPlatformAdmin({
        email: opts.adminEmail,
        password: opts.adminPassword,
        requestId: opts.requestId,
      });
      adminUserId = inserted.adminUserId;
    } catch (err) {
      await this.#emit({
        result: "failed",
        deniedReason: "db_insert_error",
        requestId: opts.requestId,
      });
      throw err;
    }

    try {
      await this.#wormMarker.recordBootstrap({
        admin_user_id: adminUserId,
        completed_at: new Date().toISOString(),
        request_id: opts.requestId,
      });
    } catch (err) {
      // Partial-success: DB has the admin, marker write failed. Emit
      // a `failed` row so the operator can find the half-completed
      // bootstrap. Re-running bootstrap will now fail gate #1
      // (admin exists) AND the WORM marker MAY succeed on retry —
      // operator must investigate.
      await this.#emit({
        result: "failed",
        deniedReason: "worm_write_error",
        requestId: opts.requestId,
        adminUserId,
      });
      throw err;
    }

    await this.#emit({
      result: "succeeded",
      requestId: opts.requestId,
      adminUserId,
    });

    return { adminUserId };
  }

  async #emit(args: {
    result: "succeeded" | "denied" | "failed";
    requestId: string;
    deniedReason?: string;
    adminUserId?: string;
  }): Promise<void> {
    const metadata: Record<string, unknown> = {};
    if (args.deniedReason !== undefined) {
      metadata.denied_reason = args.deniedReason;
    }
    if (args.adminUserId !== undefined) {
      metadata.admin_user_id = args.adminUserId;
    }
    await this.#auditLogger.write({
      // Bootstrap is platform-scope; no workspace exists yet.
      workspaceId: null,
      // The user the bootstrap creates does not exist when this row
      // prepares; subsequent bootstrap attempts (denied) similarly
      // have no caller identity. v4 §19.1 + V4-R3.
      actorUserId: null,
      actorType: "unauthenticated",
      action: "bootstrap.completed",
      result: args.result,
      requestId: args.requestId,
      metadata,
    });
  }
}

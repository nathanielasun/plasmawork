/**
 * Capsule version + lock service — Phase 0.5 Layer-3 (L3.4).
 *
 * Source contract: secure_multi_user_scaffolding_plan_v4.md §20
 * (Capsule Locking and Versioning).
 *
 * Three responsibilities:
 *
 *   1. **Optimistic versioning.** Every capsule update is If-Match-style:
 *      the caller submits the `expectedBaseVersionId` they read from
 *      `capsules.current_version_id`. Inside a single SERIALIZABLE-style
 *      transaction we re-read `current_version_id`, refuse if it has
 *      drifted, INSERT a new `capsule_versions` row, and UPDATE
 *      `capsules.current_version_id`. The `(capsule_id, version_number)`
 *      unique index is the deterministic safety net for the race in
 *      which two callers both pass the SELECT-then-check phase: the
 *      late writer trips `23505` and we re-throw as `VERSION_CONFLICT`.
 *
 *   2. **Explicit locks.** `acquireLock` performs an UPSERT on
 *      `capsule_locks` with a `WHERE capsule_locks.expires_at <= now()`
 *      predicate so a non-expired lock is conflict-preserving and a
 *      stale lock is silently replaced. The raw token is returned to
 *      the caller exactly once; only `hashToken(rawToken)` is persisted.
 *      `releaseLock` deletes by `(capsule_id, lock_token_hash,
 *      lock_context_hash)`; a non-matching presentation is a no-op
 *      audit-emitting event so stale-lock attempts are observable
 *      (`capsule.read` + `denied_reason: lock_release_mismatch`).
 *
 *   3. **Forks.** `forkCapsule` creates a new capsule + v1 version
 *      pointing at the same `contentHash` / `storagePath`. The lock is
 *      not required for a fork because it operates on a fresh capsule.
 *
 * Audit emission: Layer-3 audit goes through L1.7 `AuditLogger`. We
 * only emit on the state-change boundary (`capsule.updated`,
 * `capsule.forked`) and on the observable rejection
 * (`capsule.read` for stale-lock attempts). Acquire/release of a
 * still-held or successfully-issued lock is *not* an audit event by
 * itself: §19.5 frames audits at the user-visible state change, and
 * the caller transitions to `capsule.updated` if anything actually
 * persists.
 *
 * Concurrency model: every state change runs inside `sql.begin(...)`
 * (postgres-js's transaction helper). The audit write uses the same
 * top-level `Sql` after the tx commits — this matches the pattern
 * elsewhere in `packages/secure_core/`, where the success-path audit
 * is non-atomic with the business-row write but still emits on the
 * happy path. Failure paths throw before the audit emit, so there is
 * no half-failure to log.
 *
 * v4 §3 envelope: every refusal raises `VersionConflictError` with a
 * details payload the Fastify error handler maps to the §3 envelope.
 */

import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

import type { AuditLogger } from "../audit/logger.js";
import { canonicalize } from "../crypto/jcs.js";
import {
  compareTokenConstantTime,
  hashToken,
  mintToken,
} from "../crypto/tokens.js";
import { NotFoundError, VersionConflictError } from "../errors/shapes.js";

/** Default lock TTL — 5 minutes. v4 §20 doesn't pin a value; this
 * matches the §16 approval-token TTL family and gives a workbench
 * editor enough headroom to compose an update without stalling other
 * callers indefinitely. */
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

export interface CapsuleVersionLockServiceOptions {
  /** Top-level postgres-js `Sql` client. Must have INSERT/UPDATE/DELETE
   * privileges on `capsules`, `capsule_versions`, and `capsule_locks`
   * for the connecting role. The L1.5 fixtures pass the migrator-role
   * client; L4 wiring passes `pool.sql` from the `secure_core_app`
   * pool. */
  sql: Sql;
  /** Wired audit logger. Constructed at app boot with a writer that
   * inserts into `audit_events`; in tests, an in-memory writer is
   * fine. */
  auditLogger: AuditLogger;
  /** Optional override for the default 5-minute lock TTL. */
  defaultLockTtlMs?: number;
  /** Optional clock for deterministic tests. */
  now?: () => Date;
}

/** Options for `acquireLock`. All fields are server-derived in the
 * Layer-3 caller; nothing here corresponds to a request-body field
 * that the API would accept verbatim. */
export interface AcquireLockOptions {
  capsuleId: string;
  workspaceId: string;
  /** The user the lock is attributed to. Server-derived from
   * `req.auth.userId` per §6 / §19. */
  lockedBy: string;
  /** Request id (uuid-shaped) for audit correlation, even though
   * acquireLock itself does not emit. Threaded through so every
   * acquire/update/release is traceable in upstream logs. */
  requestId: string;
  /** Context the lock is bound to. `baseVersionId` is the
   * `currentVersionId` the caller read; `reason` is a free-text label
   * the UI surfaces. Both feed `lockContextHash`. */
  lockContext: {
    baseVersionId: string;
    reason: string;
  };
  /** Override the default TTL (ms). */
  ttlMs?: number;
}

export interface AcquireLockResult {
  rawToken: string;
  lockRow: CapsuleLockRow;
}

export interface CapsuleLockRow {
  capsule_id: string;
  workspace_id: string;
  locked_by: string;
  lock_token_hash: string;
  lock_context_hash: string;
  locked_at: Date;
  expires_at: Date;
}

export interface ReleaseLockOptions {
  capsuleId: string;
  workspaceId: string;
  /** Server-derived actor for the rejection audit. The lock's owner
   * (`lockedBy`) and the releaser are not necessarily the same
   * (e.g. a workspace admin force-releasing a stale lock); the
   * releaser is what attaches to the audit row. */
  actorUserId: string;
  actorType: "human" | "ai_agent";
  requestId: string;
  /** The raw token the caller presents. Hashed and constant-time
   * compared against the stored `lock_token_hash`. */
  presentedRawToken: string;
  /** The `(baseVersionId, lockedBy)` pair the caller claims the lock
   * was bound to. Hashed and matched against the stored
   * `lock_context_hash` so a caller can't release a lock they don't
   * own by guessing the token. */
  expectedContext: {
    baseVersionId: string;
    lockedBy: string;
  };
}

export interface UpdateCapsuleOptions {
  capsuleId: string;
  workspaceId: string;
  /** The `current_version_id` the caller read before composing the
   * update. If the persisted value disagrees we throw
   * VERSION_CONFLICT. */
  expectedBaseVersionId: string;
  newContent: {
    contentHash: string;
    storagePath: string;
  };
  /** Server-derived actor for the success-path audit. */
  actorUserId: string;
  actorType: "human" | "ai_agent";
  requestId: string;
  /** Optional: when the caller holds a lock, present the raw token
   * so the service can verify it AND release it atomically inside
   * the same tx as the version insert. Mismatch → VERSION_CONFLICT
   * (the caller is operating against a lock they do not own). */
  lockToken?: string;
}

export interface UpdateCapsuleResult {
  newVersionId: string;
  versionNumber: number;
}

export interface ForkCapsuleOptions {
  /** Source capsule (must already exist; not validated for tombstone
   * here — Layer-2 enforces workspace + soft-delete). */
  sourceCapsuleId: string;
  /** The version the fork is taken from. Its content_hash +
   * storage_path become the new capsule's v1. */
  sourceVersionId: string;
  /** Workspace the new capsule is created in. May differ from the
   * source's workspace under future cross-workspace fork policy;
   * Layer-2 will gate that with a capability check. */
  targetWorkspaceId: string;
  newCapsuleName: string;
  /** Server-derived actor. Becomes both the capsule's `created_by`
   * and the v1's `created_by` row. */
  actorUserId: string;
  actorType: "human" | "ai_agent";
  requestId: string;
  /** Optional UUID for the new capsule (testing). Default: uuid v4. */
  newCapsuleId?: string;
}

export interface ForkCapsuleResult {
  newCapsuleId: string;
  newVersionId: string;
}

export interface CapsuleRow {
  id: string;
  workspace_id: string;
  name: string;
  current_version_id: string | null;
  created_by: string;
  created_at: Date;
  deleted_at: Date | null;
}

export interface CreateCapsuleOptions {
  capsuleId?: string;
  workspaceId: string;
  name: string;
  /** Server-derived actor (req.auth.userId). Becomes capsules.created_by
   * and v1's created_by. */
  createdBy: string;
  actorType: "human" | "ai_agent";
  requestId: string;
  contentHash: string;
  storagePath: string;
}

export interface CreateCapsuleResult {
  capsuleId: string;
  versionId: string;
  versionNumber: number;
}

/**
 * Internal: build the canonicalized lock-context payload, then hash
 * it. The caller's claimed `(workspaceId, capsuleId, baseVersionId,
 * lockedBy)` quadruple is the binding; presenting a different
 * baseVersionId or claiming a different `lockedBy` produces a
 * different hash and the lock cannot be released.
 */
function computeLockContextHash(input: {
  capsuleId: string;
  workspaceId: string;
  baseVersionId: string;
  lockedBy: string;
}): string {
  const canonical = canonicalize({
    capsuleId: input.capsuleId,
    workspaceId: input.workspaceId,
    baseVersionId: input.baseVersionId,
    lockedBy: input.lockedBy,
  });
  return hashToken(canonical);
}

interface PostgresErrorLike {
  code?: string;
  constraint_name?: string;
  message?: string;
}

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const e = err as PostgresErrorLike;
  if (e.code !== "23505") {
    return false;
  }
  if (constraint === undefined) {
    return true;
  }
  return e.constraint_name === constraint;
}

export class CapsuleVersionLockService {
  private readonly sql: Sql;
  private readonly auditLogger: AuditLogger;
  private readonly defaultLockTtlMs: number;
  private readonly now: () => Date;

  public constructor(opts: CapsuleVersionLockServiceOptions) {
    this.sql = opts.sql;
    this.auditLogger = opts.auditLogger;
    this.defaultLockTtlMs = opts.defaultLockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.now = opts.now ?? ((): Date => new Date());
  }

  /**
   * Acquire (or stale-replace) a lock on a capsule. Returns the raw
   * token exactly once — the caller transmits it back to the client.
   *
   * Atomicity: the UPSERT's `WHERE capsule_locks.expires_at <= now()`
   * predicate runs inside Postgres at row-update time, so the
   * "non-expired lock blocks; expired lock is replaced" decision is
   * atomic. The INSERT path takes effect when no row exists at all.
   * `RETURNING` produces the row when (and only when) the upsert
   * applied; an active lock blocks both branches and yields zero rows.
   */
  public async acquireLock(
    opts: AcquireLockOptions,
  ): Promise<AcquireLockResult> {
    const ttlMs = opts.ttlMs ?? this.defaultLockTtlMs;
    const lockedAt = this.now();
    const expiresAt = new Date(lockedAt.getTime() + ttlMs);
    const rawToken = mintToken();
    const lockTokenHash = hashToken(rawToken);
    const lockContextHash = computeLockContextHash({
      capsuleId: opts.capsuleId,
      workspaceId: opts.workspaceId,
      baseVersionId: opts.lockContext.baseVersionId,
      lockedBy: opts.lockedBy,
    });

    const rows = await this.sql<CapsuleLockRow[]>`
      INSERT INTO capsule_locks (
        capsule_id, workspace_id, locked_by,
        lock_token_hash, lock_context_hash,
        locked_at, expires_at
      ) VALUES (
        ${opts.capsuleId}, ${opts.workspaceId}, ${opts.lockedBy},
        ${lockTokenHash}, ${lockContextHash},
        ${lockedAt}, ${expiresAt}
      )
      ON CONFLICT (capsule_id) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        locked_by = EXCLUDED.locked_by,
        lock_token_hash = EXCLUDED.lock_token_hash,
        lock_context_hash = EXCLUDED.lock_context_hash,
        locked_at = EXCLUDED.locked_at,
        expires_at = EXCLUDED.expires_at
      WHERE capsule_locks.expires_at <= ${lockedAt}
      RETURNING capsule_id, workspace_id, locked_by,
                lock_token_hash, lock_context_hash,
                locked_at, expires_at
    `;

    if (rows.length === 0) {
      throw new VersionConflictError("Capsule is locked by another caller.", {
        conflict: "lock_held",
        capsule_id: opts.capsuleId,
      });
    }

    return { rawToken, lockRow: rows[0] };
  }

  /**
   * Release a held lock. Idempotent: a presented token that no longer
   * matches a row (because the lock expired and was replaced, or
   * because the caller mixed up their state) deletes nothing and
   * emits a `capsule.read` audit row with `denied_reason:
   * lock_release_mismatch` so the stale-lock attempt is observable.
   *
   * The constant-time comparison runs on the SELECT'd hash before the
   * DELETE — the DELETE itself is a hash-equality predicate, but the
   * pre-check stops a release attempt that doesn't match from
   * generating a noisy DELETE-of-zero. (Rule: validate ALL inputs
   * before side effects.)
   */
  public async releaseLock(opts: ReleaseLockOptions): Promise<void> {
    const presentedTokenHash = hashToken(opts.presentedRawToken);
    const expectedContextHash = computeLockContextHash({
      capsuleId: opts.capsuleId,
      workspaceId: opts.workspaceId,
      baseVersionId: opts.expectedContext.baseVersionId,
      lockedBy: opts.expectedContext.lockedBy,
    });

    const stored = await this.sql<
      Pick<CapsuleLockRow, "lock_token_hash" | "lock_context_hash">[]
    >`
      SELECT lock_token_hash, lock_context_hash
      FROM capsule_locks
      WHERE capsule_id = ${opts.capsuleId}
    `;

    let matches = false;
    if (stored.length === 1) {
      const tokenOk = compareTokenConstantTime(
        opts.presentedRawToken,
        stored[0].lock_token_hash,
      );
      const contextOk =
        stored[0].lock_context_hash === expectedContextHash;
      matches = tokenOk && contextOk;
    }

    if (!matches) {
      // Audit BEFORE returning so a half-observation produces a row
      // even if a downstream caller short-circuits on the throw.
      await this.auditLogger.write({
        workspaceId: opts.workspaceId,
        actorUserId: opts.actorUserId,
        actorType: opts.actorType,
        action: "capsule.read",
        objectType: "capsule",
        objectId: opts.capsuleId,
        result: "denied",
        requestId: opts.requestId,
        metadata: { denied_reason: "lock_release_mismatch" },
      });
      return;
    }

    await this.sql`
      DELETE FROM capsule_locks
      WHERE capsule_id = ${opts.capsuleId}
        AND lock_token_hash = ${presentedTokenHash}
        AND lock_context_hash = ${expectedContextHash}
    `;
  }

  /**
   * If-Match-style conditional update. Inside a single tx:
   *
   *   1. SELECT `current_version_id` and the highest existing
   *      `version_number` for the capsule (FOR UPDATE on the parent
   *      row so two concurrent updates serialize against the row
   *      lock).
   *   2. If the persisted `current_version_id` !==
   *      `expectedBaseVersionId`, throw VERSION_CONFLICT with the
   *      observed values.
   *   3. If `lockToken` is provided, fetch the stored hash and
   *      constant-time compare; mismatch → VERSION_CONFLICT.
   *   4. INSERT the new `capsule_versions` row at `top + 1`. The
   *      `(capsule_id, version_number)` unique index is the
   *      tie-breaker for a parallel race that both passed the
   *      SELECT — the late writer trips `23505` and we re-throw as
   *      VERSION_CONFLICT.
   *   5. UPDATE `capsules.current_version_id`.
   *   6. If `lockToken` was provided, DELETE the lock atomically.
   *
   * After the tx commits, emit `capsule.updated`.
   */
  public async updateCapsule(
    opts: UpdateCapsuleOptions,
  ): Promise<UpdateCapsuleResult> {
    const newVersionId = randomUUID();

    const result = await this.sql.begin(async (tx) => {
      const headRows = await tx<
        { current_version_id: string | null; top: number | null }[]
      >`
        SELECT
          c.current_version_id AS current_version_id,
          (
            SELECT MAX(cv.version_number)
            FROM capsule_versions cv
            WHERE cv.capsule_id = c.id
          ) AS top
        FROM capsules c
        WHERE c.id = ${opts.capsuleId}
          AND c.workspace_id = ${opts.workspaceId}
        FOR UPDATE
      `;

      if (headRows.length === 0) {
        throw new VersionConflictError(
          "Capsule was modified after this version was loaded.",
          {
            conflict: "capsule_missing",
            capsule_id: opts.capsuleId,
          },
        );
      }

      const head = headRows[0];
      if (head.current_version_id !== opts.expectedBaseVersionId) {
        throw new VersionConflictError(
          "Capsule was modified after this version was loaded.",
          {
            conflict: "stale_base_version",
            currentVersionId: head.current_version_id,
            submittedBaseVersionId: opts.expectedBaseVersionId,
          },
        );
      }

      if (opts.lockToken !== undefined) {
        const lockRows = await tx<{ lock_token_hash: string }[]>`
          SELECT lock_token_hash
          FROM capsule_locks
          WHERE capsule_id = ${opts.capsuleId}
        `;
        if (lockRows.length !== 1) {
          throw new VersionConflictError("Lock token mismatch.", {
            conflict: "lock_missing",
          });
        }
        const ok = compareTokenConstantTime(
          opts.lockToken,
          lockRows[0].lock_token_hash,
        );
        if (!ok) {
          throw new VersionConflictError("Lock token mismatch.", {
            conflict: "lock_token_mismatch",
          });
        }
      }

      const nextVersionNumber = (head.top ?? 0) + 1;

      try {
        await tx`
          INSERT INTO capsule_versions (
            id, capsule_id, workspace_id, version_number,
            content_hash, storage_path, created_by
          ) VALUES (
            ${newVersionId}, ${opts.capsuleId}, ${opts.workspaceId},
            ${nextVersionNumber},
            ${opts.newContent.contentHash}, ${opts.newContent.storagePath},
            ${opts.actorUserId}
          )
        `;
      } catch (err) {
        if (
          isUniqueViolation(err, "capsule_versions_capsule_version_unique")
        ) {
          throw new VersionConflictError(
            "Capsule was modified after this version was loaded.",
            {
              conflict: "version_number_collision",
              attempted_version_number: nextVersionNumber,
            },
          );
        }
        throw err;
      }

      await tx`
        UPDATE capsules
        SET current_version_id = ${newVersionId}
        WHERE id = ${opts.capsuleId}
      `;

      if (opts.lockToken !== undefined) {
        await tx`
          DELETE FROM capsule_locks
          WHERE capsule_id = ${opts.capsuleId}
        `;
      }

      return { versionNumber: nextVersionNumber };
    });

    await this.auditLogger.write({
      workspaceId: opts.workspaceId,
      actorUserId: opts.actorUserId,
      actorType: opts.actorType,
      action: "capsule.updated",
      objectType: "capsule",
      objectId: opts.capsuleId,
      result: "succeeded",
      requestId: opts.requestId,
      metadata: {
        version_id: newVersionId,
        previous_version_id: opts.expectedBaseVersionId,
      },
    });

    return { newVersionId, versionNumber: result.versionNumber };
  }

  /**
   * Fork a capsule: create a new `capsules` row and a v1
   * `capsule_versions` row pointing at the same `(content_hash,
   * storage_path)` as the source version. The new capsule's
   * `current_version_id` points at the v1.
   *
   * Storage-copy semantics are out of scope here: callers that want
   * to copy the underlying object-store payload do so before
   * invoking this method (and supply the new `storage_path` /
   * `content_hash` themselves through a thin wrapper). The default
   * "share storage" behavior is correct for content-addressed
   * artifacts.
   */
  public async forkCapsule(
    opts: ForkCapsuleOptions,
  ): Promise<ForkCapsuleResult> {
    const newCapsuleId = opts.newCapsuleId ?? randomUUID();
    const newVersionId = randomUUID();

    await this.sql.begin(async (tx) => {
      const sourceRows = await tx<
        {
          content_hash: string;
          storage_path: string;
        }[]
      >`
        SELECT content_hash, storage_path
        FROM capsule_versions
        WHERE id = ${opts.sourceVersionId}
          AND capsule_id = ${opts.sourceCapsuleId}
      `;
      if (sourceRows.length === 0) {
        throw new VersionConflictError(
          "Source capsule version not found for fork.",
          {
            conflict: "fork_source_missing",
            source_capsule_id: opts.sourceCapsuleId,
            source_version_id: opts.sourceVersionId,
          },
        );
      }
      const source = sourceRows[0];

      await tx`
        INSERT INTO capsules (id, workspace_id, name, created_by)
        VALUES (${newCapsuleId}, ${opts.targetWorkspaceId},
                ${opts.newCapsuleName}, ${opts.actorUserId})
      `;

      await tx`
        INSERT INTO capsule_versions (
          id, capsule_id, workspace_id, version_number,
          content_hash, storage_path, created_by
        ) VALUES (
          ${newVersionId}, ${newCapsuleId}, ${opts.targetWorkspaceId}, 1,
          ${source.content_hash}, ${source.storage_path},
          ${opts.actorUserId}
        )
      `;

      await tx`
        UPDATE capsules SET current_version_id = ${newVersionId}
        WHERE id = ${newCapsuleId}
      `;
    });

    await this.auditLogger.write({
      workspaceId: opts.targetWorkspaceId,
      actorUserId: opts.actorUserId,
      actorType: opts.actorType,
      action: "capsule.forked",
      objectType: "capsule",
      objectId: newCapsuleId,
      result: "succeeded",
      requestId: opts.requestId,
      metadata: {
        version_id: newVersionId,
      },
    });

    return { newCapsuleId, newVersionId };
  }

  /** List non-deleted capsules in a workspace, newest first. */
  public async listCapsules(workspaceId: string): Promise<CapsuleRow[]> {
    const rows = await this.sql<CapsuleRow[]>`
      SELECT id, workspace_id, name, current_version_id,
             created_by, created_at, deleted_at
      FROM capsules
      WHERE workspace_id = ${workspaceId}
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
    return rows;
  }

  /** Read a single non-deleted capsule by id, scoped to workspace. */
  public async getCapsule(
    capsuleId: string,
    workspaceId: string,
  ): Promise<CapsuleRow> {
    const rows = await this.sql<CapsuleRow[]>`
      SELECT id, workspace_id, name, current_version_id,
             created_by, created_at, deleted_at
      FROM capsules
      WHERE id = ${capsuleId}
        AND workspace_id = ${workspaceId}
        AND deleted_at IS NULL
    `;
    if (rows.length === 0) {
      throw new NotFoundError("Capsule not found.", {
        capsule_id: capsuleId,
      });
    }
    return rows[0];
  }

  /** Create a fresh capsule + v1 in a single tx; emits capsule.created. */
  public async createCapsule(
    opts: CreateCapsuleOptions,
  ): Promise<CreateCapsuleResult> {
    const newCapsuleId = opts.capsuleId ?? randomUUID();
    const newVersionId = randomUUID();

    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO capsules (id, workspace_id, name, created_by)
        VALUES (${newCapsuleId}, ${opts.workspaceId},
                ${opts.name}, ${opts.createdBy})
      `;
      await tx`
        INSERT INTO capsule_versions (
          id, capsule_id, workspace_id, version_number,
          content_hash, storage_path, created_by
        ) VALUES (
          ${newVersionId}, ${newCapsuleId}, ${opts.workspaceId}, 1,
          ${opts.contentHash}, ${opts.storagePath},
          ${opts.createdBy}
        )
      `;
      await tx`
        UPDATE capsules SET current_version_id = ${newVersionId}
        WHERE id = ${newCapsuleId}
      `;
    });

    await this.auditLogger.write({
      workspaceId: opts.workspaceId,
      actorUserId: opts.createdBy,
      actorType: opts.actorType,
      action: "capsule.created",
      objectType: "capsule",
      objectId: newCapsuleId,
      result: "succeeded",
      requestId: opts.requestId,
      metadata: { version_id: newVersionId },
    });

    return { capsuleId: newCapsuleId, versionId: newVersionId, versionNumber: 1 };
  }
}

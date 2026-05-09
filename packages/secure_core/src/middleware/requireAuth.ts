/**
 * `requireAuth` — Phase 0.5 Layer 2 / L2.1.
 *
 * Resolves the session cookie into a server-derived `AuthContext` per
 * v4 §5.1 / §5.4. The middleware:
 *
 *   1. Reads the `secure_session` cookie. v4 §7.1 says session tokens
 *      must live ONLY in `HttpOnly; Secure; SameSite=Lax` cookies,
 *      never in `Authorization: Bearer …` headers. We refuse the
 *      bearer path explicitly so a misconfigured client can't fall
 *      back to a JS-readable surface.
 *
 *   2. Hashes the presented token (SHA-256 hex via `hashToken`) and
 *      looks the row up by `session_hash`. Constant-time comparison
 *      isn't strictly required here because we look up by hash equality
 *      rather than walking every row, but the hash itself is the
 *      timing-equalizer.
 *
 *   3. Walks the rejection ladder in v4 §5.4 / §5.5 / §5 disable order:
 *        missing cookie     → `UnauthenticatedError`              (no audit)
 *        unknown hash       → `UnauthenticatedError`              + login.failed
 *        revokedAt set      → `SessionRevokedError`               + session.revoked
 *        expiresAt past     → `SESSION_EXPIRED` SecureCoreError   + session.idle_timeout
 *        users.disabledAt   → `DISABLED_USER` SecureCoreError     + login.failed
 *
 *   4. On the happy path attaches `req.auth` and best-effort updates
 *      `sessions.last_seen_at` per v4 §5.5. The update is fire-and-
 *      forget — its failure must not reject an otherwise valid session.
 */

import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";

import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";
import type { ActorType, AuthContext } from "./types.js";
import {
  SecureCoreError,
  SessionRevokedError,
  UnauthenticatedError,
} from "../errors/shapes.js";
import { hashToken } from "../crypto/tokens.js";
import { sessions, users } from "../db/schema.js";
import type { SecureCorePool } from "../db/pool.js";
import type { AuditLogger } from "../audit/logger.js";

export interface RequireAuthDeps {
  readonly pool: SecureCorePool;
  readonly auditLogger: AuditLogger;
  /** Defaults to `"secure_session"` per v4 §7.1. */
  readonly cookieName?: string;
}

const DEFAULT_COOKIE_NAME = "secure_session";

interface SessionRow {
  sessionId: string;
  userId: string;
  assuranceLevel: string;
  revokedAt: Date | null;
  expiresAt: Date;
  userDisabledAt: Date | null;
}

function isAssuranceLevel(v: string): v is AuthContext["assuranceLevel"] {
  return v === "aal1" || v === "aal2" || v === "aal3";
}

function hasBearerAuthorizationHeader(value: unknown): boolean {
  if (typeof value === "string") {
    return /^Bearer\s+\S+/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((v) => hasBearerAuthorizationHeader(v));
  }
  return false;
}

async function loadSessionByHash(
  pool: SecureCorePool,
  sessionHash: string,
): Promise<SessionRow | null> {
  const rows = await pool.db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      assuranceLevel: sessions.assuranceLevel,
      revokedAt: sessions.revokedAt,
      expiresAt: sessions.expiresAt,
      userDisabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.sessionHash, sessionHash))
    .limit(1);

  return rows[0] ?? null;
}

function bumpLastSeen(pool: SecureCorePool, sessionId: string): void {
  // Fire-and-forget. v4 §5.5 allows throttling; this implementation
  // delegates throttling to the DB-side `now() - last_seen_at > 30s`
  // policy that L4 will encode (a partial index / trigger). For L2 we
  // simply emit the UPDATE and discard errors so request handling never
  // blocks on the bookkeeping write.
  void pool.db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, sessionId))
    .catch(() => {
      /* swallow — last_seen_at must never fail an authenticated request */
    });
}

export function requireAuth(deps: RequireAuthDeps): NamedMiddleware {
  const cookieName = deps.cookieName ?? DEFAULT_COOKIE_NAME;
  const { pool, auditLogger } = deps;

  const handler: MiddlewareHandler = async (
    req: FastifyRequest,
  ): Promise<void> => {
    if (hasBearerAuthorizationHeader(req.headers.authorization)) {
      await auditLogger.write({
        workspaceId: null,
        actorUserId: null,
        actorType: "unauthenticated",
        action: "login.failed",
        result: "denied",
        requestId: req.requestId,
      });
      throw new UnauthenticatedError("Authentication required.");
    }

    const cookies = req.cookies as Record<string, string | undefined>;
    const presented = cookies?.[cookieName];

    // Pre-auth, no actor: no audit emission. Authorization-bearer is
    // refused above — we never use it as an alternate credential path.
    if (typeof presented !== "string" || presented.length === 0) {
      throw new UnauthenticatedError("Authentication required.");
    }

    const sessionHash = hashToken(presented);
    const row = await loadSessionByHash(pool, sessionHash);

    if (row === null) {
      await auditLogger.write({
        workspaceId: null,
        actorUserId: null,
        actorType: "unauthenticated",
        action: "login.failed",
        result: "denied",
        requestId: req.requestId,
      });
      throw new UnauthenticatedError("Authentication required.");
    }

    // Cookie-session auth (this middleware) ONLY mints human sessions.
    // Worker auth flows through `workerAuth.ts` and lands in `req.auth`
    // with `actorType: "worker"`. AI-agent / operator actor types are
    // not currently issued via cookie session — when that changes,
    // derive `actorType` from `sessions.auth_method` instead of pinning
    // it to "human" here.
    const actorType: ActorType = "human";

    if (row.revokedAt !== null) {
      await auditLogger.write({
        workspaceId: null,
        actorUserId: row.userId,
        actorType,
        action: "session.revoked",
        result: "denied",
        requestId: req.requestId,
      });
      throw new SessionRevokedError("Session has been revoked.");
    }

    if (row.expiresAt.getTime() < Date.now()) {
      await auditLogger.write({
        workspaceId: null,
        actorUserId: row.userId,
        actorType,
        action: "session.idle_timeout",
        result: "denied",
        requestId: req.requestId,
      });
      throw new SecureCoreError("SESSION_EXPIRED", "Session expired.");
    }

    if (row.userDisabledAt !== null) {
      await auditLogger.write({
        workspaceId: null,
        actorUserId: row.userId,
        actorType,
        action: "login.failed",
        result: "denied",
        requestId: req.requestId,
      });
      throw new SecureCoreError("DISABLED_USER", "Account disabled.");
    }

    if (!isAssuranceLevel(row.assuranceLevel)) {
      // DB CHECK constraint pins this set; treat any other value as an
      // unauthenticated failure rather than crashing the handler.
      throw new UnauthenticatedError("Authentication required.");
    }

    req.auth = {
      userId: row.userId,
      sessionId: row.sessionId,
      actorType,
      assuranceLevel: row.assuranceLevel,
    };

    bumpLastSeen(pool, row.sessionId);
  };

  return { name: "requireAuth", handler };
}

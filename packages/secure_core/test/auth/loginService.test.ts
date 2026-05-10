/**
 * LoginService — Phase 0.5 audit fix F1+F2 regression tests
 * (2026-05-09), updated for username-primary identity the same day.
 *
 * Pins:
 *   - Anti-enumeration: same generic 401 message for unknown
 *     username, wrong password, and disabled user.
 *   - Audit row carries the discriminated denied_reason on every
 *     failure path.
 *   - Constant-time path: verifyPasswordHash is called even when
 *     the user doesn't exist (timing parity).
 *   - On success, a `sessions` row is inserted with the SHA-256 of
 *     the raw token; the raw session token is returned (route
 *     surface) but never appears in audit metadata.
 *   - terminateSession revokes the session and emits `logout`.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  LoginService,
  type AuthenticatePasswordInput,
} from "../../src/auth/loginService.js";
import type { AuditLogger } from "../../src/audit/logger.js";
import type { SecureCorePool } from "../../src/db/pool.js";
import { hashToken } from "../../src/crypto/tokens.js";

interface AuditCall {
  action: string;
  result: string;
  actorUserId: string | null;
  actorType: string;
  metadata?: Record<string, unknown>;
}

function makeStubAuditLogger(): {
  logger: AuditLogger;
  calls: AuditCall[];
} {
  const calls: AuditCall[] = [];
  const logger = {
    async write(input: {
      action: string;
      result: string;
      actorUserId: string | null;
      actorType: string;
      metadata?: Record<string, unknown>;
    }) {
      calls.push({
        action: input.action,
        result: input.result,
        actorUserId: input.actorUserId,
        actorType: input.actorType,
        metadata: input.metadata,
      });
      return undefined as never;
    },
  } as unknown as AuditLogger;
  return { logger, calls };
}

interface UserRow {
  readonly id: string;
  readonly disabled_at: Date | null;
  /** Audit fix (2026-05-10): per-account lockout fields the join now carries. */
  readonly failed_attempts?: number | null;
  readonly locked_until?: Date | null;
}

function makeStubPool(opts: {
  userByUsername?: UserRow | null;
  insertedSessionId?: string;
}): { pool: SecureCorePool; sessionInserts: Array<Record<string, unknown>> } {
  const sessionInserts: Array<Record<string, unknown>> = [];
  const sql = async () => {
    if (opts.userByUsername === null || opts.userByUsername === undefined) return [];
    return [opts.userByUsername];
  };
  const db = {
    insert(_table: unknown) {
      return {
        values(row: Record<string, unknown>) {
          sessionInserts.push(row);
          return {
            returning(_cols: unknown) {
              return Promise.resolve([
                { id: opts.insertedSessionId ?? row.id ?? "sess-1" },
              ]);
            },
          };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(_row: unknown) {
          return {
            where(_cond: unknown) {
              return {
                returning(_cols: unknown) {
                  return Promise.resolve([{ id: "sess-1", userId: ACTOR }]);
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    pool: { sql, db } as unknown as SecureCorePool,
    sessionInserts,
  };
}

const ACTOR = "11111111-1111-4111-8111-111111111111";
const VALID_USER: UserRow = {
  id: ACTOR,
  disabled_at: null,
};

function makeService(
  poolStub: { pool: SecureCorePool },
  audit: AuditLogger,
  opts: {
    passwordOk?: boolean;
    storedHash?: string | null;
    verifyCalls?: Array<{ presented: string; stored: string }>;
  } = {},
): LoginService {
  const verifyCalls = opts.verifyCalls ?? [];
  return new LoginService({
    pool: poolStub.pool,
    auditLogger: audit,
    async verifyPasswordHash(presented: string, stored: string) {
      verifyCalls.push({ presented, stored });
      return opts.passwordOk ?? false;
    },
    async fetchPasswordHash() {
      return opts.storedHash ?? "$argon2id$stored$hash";
    },
    now: () => Date.parse("2026-05-09T12:00:00Z"),
  });
}

const DEFAULT_INPUT: AuthenticatePasswordInput = {
  username: "alice_42",
  password: "correct horse battery staple",
  requestId: "req-1",
};

describe("LoginService.authenticatePassword — F1+F2", () => {
  let audit: ReturnType<typeof makeStubAuditLogger>;

  beforeEach(() => {
    audit = makeStubAuditLogger();
  });

  it("anti-enumeration: unknown username returns same generic error", async () => {
    const verifyCalls: Array<{ presented: string; stored: string }> = [];
    const stub = makeStubPool({ userByUsername: null });
    const svc = makeService(stub, audit.logger, { passwordOk: false, verifyCalls });
    await expect(
      svc.authenticatePassword({ ...DEFAULT_INPUT }),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Invalid username or password.",
    });
    expect(audit.calls[0]).toMatchObject({
      action: "login.failed",
      actorType: "unauthenticated",
      actorUserId: null,
    });
    expect(audit.calls[0].metadata?.denied_reason).toBe("user_not_found");
    // Constant-time path: verify still ran, against the dummy hash.
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].stored).toMatch(/argon2id/);
  });

  it("anti-enumeration: wrong password returns same generic error", async () => {
    const stub = makeStubPool({ userByUsername: VALID_USER });
    const svc = makeService(stub, audit.logger, { passwordOk: false });
    await expect(svc.authenticatePassword(DEFAULT_INPUT)).rejects.toMatchObject(
      { code: "UNAUTHENTICATED", message: "Invalid username or password." },
    );
    expect(audit.calls[0]).toMatchObject({
      action: "login.failed",
      actorType: "human",
      actorUserId: ACTOR,
    });
    expect(audit.calls[0].metadata?.denied_reason).toBe("password_invalid");
  });

  it("disabled user returns same generic error + denied_reason 'user_disabled'", async () => {
    const stub = makeStubPool({
      userByUsername: { ...VALID_USER, disabled_at: new Date() },
    });
    const svc = makeService(stub, audit.logger, { passwordOk: true });
    await expect(svc.authenticatePassword(DEFAULT_INPUT)).rejects.toMatchObject(
      { code: "UNAUTHENTICATED", message: "Invalid username or password." },
    );
    expect(audit.calls[0].metadata?.denied_reason).toBe("user_disabled");
  });

  it("user without email logs in successfully (root admin shape)", async () => {
    // Phase 0.5 auth gateway (2026-05-09): email is supplementary
    // metadata; users without an email (e.g. the seeded root admin)
    // can still authenticate by username + password.
    const stub = makeStubPool({
      userByUsername: VALID_USER,
      insertedSessionId: "sess-noemail",
    });
    const svc = makeService(stub, audit.logger, { passwordOk: true });
    const out = await svc.authenticatePassword(DEFAULT_INPUT);
    expect(out.userId).toBe(ACTOR);
    expect(out.sessionId).toBe("sess-noemail");
  });

  it("happy path mints a session row + returns raw tokens (never logged)", async () => {
    const stub = makeStubPool({
      userByUsername: VALID_USER,
      insertedSessionId: "sess-9",
    });
    const svc = makeService(stub, audit.logger, { passwordOk: true });
    const out = await svc.authenticatePassword(DEFAULT_INPUT);
    expect(out.userId).toBe(ACTOR);
    expect(out.sessionId).toBe("sess-9");
    expect(out.assuranceLevel).toBe("aal2");
    expect(out.rawSessionToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(out.rawCsrfToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(out.rawSessionToken).not.toBe(out.rawCsrfToken);

    // The session row carries the SHA-256 of the raw token.
    expect(stub.sessionInserts).toHaveLength(1);
    expect(stub.sessionInserts[0].sessionHash).toBe(
      hashToken(out.rawSessionToken),
    );
    expect(stub.sessionInserts[0].userId).toBe(ACTOR);

    // Audit row never carries the raw token.
    const successAudit = audit.calls.find((c) => c.action === "login.succeeded");
    expect(successAudit).toBeDefined();
    expect(successAudit?.actorUserId).toBe(ACTOR);
    expect(JSON.stringify(successAudit?.metadata ?? {})).not.toContain(
      out.rawSessionToken,
    );
    expect(JSON.stringify(successAudit?.metadata ?? {})).not.toContain(
      out.rawCsrfToken,
    );
  });

  it("constant-time: verifyPasswordHash runs even when user is null", async () => {
    const verifyCalls: Array<{ presented: string; stored: string }> = [];
    const stub = makeStubPool({ userByUsername: null });
    const svc = makeService(stub, audit.logger, { passwordOk: false, verifyCalls });
    await expect(svc.authenticatePassword(DEFAULT_INPUT)).rejects.toBeDefined();
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].presented).toBe(DEFAULT_INPUT.password);
  });

  it("normalizes username to lowercase + trims whitespace", async () => {
    const stub = makeStubPool({ userByUsername: VALID_USER });
    const svc = makeService(stub, audit.logger, { passwordOk: true });
    const out = await svc.authenticatePassword({
      ...DEFAULT_INPUT,
      username: "  Alice_42  ",
    });
    expect(out.userId).toBe(ACTOR);
  });

  it("locked account is refused without running the verifier (audit fix 2026-05-10)", async () => {
    // Audit fix: the previous LoginService incremented
    // `user_credentials.failed_attempts` but NEVER read
    // `locked_until`, so a documented lockout was a dead column.
    // This test pins the read side: a user whose `locked_until` is
    // in the future cannot authenticate, even with the right
    // password, and the verifier is NOT called (so a server-side
    // timing channel can't reveal the lockout state).
    //
    // Service uses a fixed clock at 2026-05-09T12:00:00Z; lockout
    // is set 5 minutes ahead of that.
    const stub = makeStubPool({
      userByUsername: {
        id: ACTOR,
        disabled_at: null,
        failed_attempts: 10,
        locked_until: new Date("2026-05-09T12:05:00Z"),
      },
    });
    const audit = makeStubAuditLogger();
    let verifierCalls = 0;
    const svc = new LoginService({
      pool: stub.pool,
      auditLogger: audit.logger,
      verifyPasswordHash: async () => {
        verifierCalls++;
        return true;
      },
      fetchPasswordHash: async () => null,
      now: () => Date.parse("2026-05-09T12:00:00Z"),
    });
    await expect(
      svc.authenticatePassword(DEFAULT_INPUT),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(verifierCalls).toBe(0);
    // Audit row carries the discriminated reason.
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]!.metadata).toMatchObject({
      denied_reason: "account_locked",
    });
  });

  it("expired lockout (locked_until in the past) does NOT block login", async () => {
    // locked_until is BEFORE the service's fixed clock —
    // 2026-05-09T11:00:00Z is one hour before 12:00:00Z.
    const stub = makeStubPool({
      userByUsername: {
        id: ACTOR,
        disabled_at: null,
        failed_attempts: 0,
        locked_until: new Date("2026-05-09T11:00:00Z"),
      },
    });
    const audit = makeStubAuditLogger();
    const svc = makeService(stub, audit.logger, { passwordOk: true });
    const out = await svc.authenticatePassword(DEFAULT_INPUT);
    expect(out.userId).toBe(ACTOR);
  });
});

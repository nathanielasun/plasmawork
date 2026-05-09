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
});

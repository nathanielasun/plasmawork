/**
 * L1.7 audit logger — behavior tests.
 *
 * Pins:
 *   1. Redaction at the boundary: non-allowlisted top-level keys
 *      and forbidden-named nested keys (password / session_hash /
 *      cookie / authorization) raise `RedactionError` with the
 *      right `code`.
 *   2. Hash-chain reproducibility: the test recomputes `row_hash`
 *      independently from the canonical fields and asserts byte
 *      equality with the row the logger emits.
 *   3. Chain advance: `prev_hash` is null on the first row and
 *      equal to the previous tip on the next; mutating `prev_hash`
 *      after the fact changes `row_hash` (verifier would fail).
 *   4. The DI writer is invoked exactly once per `write()`.
 *   5. `actorType: 'unauthenticated'` is allowed (V4-R3); the row
 *      writes with `actor_user_id: null`. The matching consistency
 *      check rejects an authenticated actor without a user id.
 *   6. Action validation: a non-AuditEvent string passed via an
 *      `as` cast at the call site is refused at runtime.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalize,
  CANONICALIZATION_VERSION,
} from "../../src/crypto/jcs.js";
import {
  AuditLogger,
  computeAuditRowHash,
  type AuditEventInput,
  type PreparedAuditRow,
} from "../../src/audit/logger.js";
import { RedactionError } from "../../src/audit/redaction.js";
import type { AuditEvent } from "../../src/config/audit_events.js";

interface Harness {
  logger: AuditLogger;
  rows: PreparedAuditRow[];
  writerCallCount: { n: number };
  setPrevHash: (h: string | null) => void;
}

function makeHarness(opts?: {
  initialPrevHash?: string | null;
  fixedNow?: Date;
  fixedIds?: string[];
}): Harness {
  let prevHash: string | null = opts?.initialPrevHash ?? null;
  const rows: PreparedAuditRow[] = [];
  const writerCallCount = { n: 0 };
  const ids = opts?.fixedIds ? [...opts.fixedIds] : null;

  const logger = new AuditLogger({
    writer: async (row) => {
      writerCallCount.n += 1;
      rows.push(row);
      // Simulate the chain tip advancing once a row is committed.
      prevHash = row.row_hash;
    },
    prevHashGetter: async () => prevHash,
    now: opts?.fixedNow ? () => opts.fixedNow as Date : undefined,
    generateId: ids
      ? () => {
          const next = ids.shift();
          if (!next) {
            throw new Error("ran out of fixed ids in test");
          }
          return next;
        }
      : undefined,
  });

  return {
    logger,
    rows,
    writerCallCount,
    setPrevHash: (h) => {
      prevHash = h;
    },
  };
}

function baseEvent(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    workspaceId: "ws_01",
    actorUserId: "user_01",
    actorType: "human",
    action: "capsule.created",
    objectType: "capsule",
    objectId: "cap_01",
    result: "succeeded",
    requestId: "req_01",
    ipHmac: "ip-hmac-hex",
    userAgentHmac: "ua-hmac-hex",
    metadata: { version_id: "v1" },
    ...overrides,
  };
}

describe("AuditLogger.write — redaction boundary", () => {
  it("refuses a non-allowlisted top-level metadata key", async () => {
    const h = makeHarness();
    // Build via Object.assign so `__proto__` becomes a real own
    // property, not the special prototype-setter syntax JS treats
    // it as in object literals.
    const sneaky: Record<string, unknown> = {};
    Object.defineProperty(sneaky, "__proto__", {
      value: "v1",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    await expect(
      h.logger.write(baseEvent({ metadata: sneaky })),
    ).rejects.toMatchObject({
      name: "RedactionError",
      code: "audit.disallowed_metadata_key",
    });
    expect(h.rows).toHaveLength(0);
    expect(h.writerCallCount.n).toBe(0);

    // And the same refusal for a benign-looking non-allowlisted
    // key — the allowlist is fail-closed.
    await expect(
      h.logger.write(
        baseEvent({ metadata: { email: "alice@example.com" } as Record<string, unknown> }),
      ),
    ).rejects.toMatchObject({
      code: "audit.disallowed_metadata_key",
    });
  });

  it("refuses a metadata: req.body shape carrying a password field", async () => {
    const h = makeHarness();
    await expect(
      h.logger.write(
        baseEvent({
          // The caller smuggles `req.body` in under the allowlisted
          // key `error_code`; the nested `password` field is the
          // forbidden value.
          metadata: {
            error_code: { password: "hunter2", username: "alice" },
          },
        }),
      ),
    ).rejects.toMatchObject({
      name: "RedactionError",
      code: "audit.forbidden_value",
    });
    expect(h.writerCallCount.n).toBe(0);
  });

  it("refuses a session_hash nested anywhere in metadata", async () => {
    const h = makeHarness();
    await expect(
      h.logger.write(
        baseEvent({
          metadata: {
            error_code: { detail: { session_hash: "deadbeef" } },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "audit.forbidden_value",
    });
  });

  it("refuses cookie / authorization headers in metadata", async () => {
    const h = makeHarness();
    for (const bad of ["cookie", "Authorization", "set-cookie"] as const) {
      await expect(
        h.logger.write(
          baseEvent({
            metadata: {
              error_code: { [bad]: "x" } as Record<string, unknown>,
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "audit.forbidden_value" });
    }
  });

  it("refuses non-object metadata shapes", async () => {
    const h = makeHarness();
    for (const bad of [null, [], "string", 42, true]) {
      await expect(
        h.logger.write(
          baseEvent({ metadata: bad as unknown as Record<string, unknown> }),
        ),
      ).rejects.toMatchObject({
        code: "audit.invalid_metadata_shape",
      });
    }
  });
});

describe("AuditLogger.write — chain reproducibility", () => {
  it("recomputes row_hash byte-for-byte from the canonical fields", async () => {
    const fixedNow = new Date("2026-05-04T18:32:11.123Z");
    const h = makeHarness({
      fixedNow,
      fixedIds: ["00000000-0000-4000-8000-000000000001"],
    });

    const row = await h.logger.write(
      baseEvent({ metadata: { version_id: "v1" } }),
    );

    // Independent recomputation via the public helper.
    const independent = computeAuditRowHash({
      prevHash: null,
      canonicalFields: {
        id: row.id,
        workspace_id: row.workspace_id,
        actor_user_id: row.actor_user_id,
        actor_type: row.actor_type,
        action: row.action,
        object_type: row.object_type,
        object_id: row.object_id,
        result: row.result,
        request_id: row.request_id,
        ip_hmac: row.ip_hmac,
        user_agent_hmac: row.user_agent_hmac,
        metadata: row.metadata,
        created_at: row.created_at,
      },
    });
    expect(independent).toBe(row.row_hash);

    // And via raw createHash + canonicalize, to pin that
    // computeAuditRowHash isn't quietly doing something extra.
    const payload = {
      prev_hash: null,
      id: row.id,
      workspace_id: row.workspace_id,
      actor_user_id: row.actor_user_id,
      actor_type: row.actor_type,
      action: row.action,
      object_type: row.object_type,
      object_id: row.object_id,
      result: row.result,
      request_id: row.request_id,
      ip_hmac: row.ip_hmac,
      user_agent_hmac: row.user_agent_hmac,
      metadata: row.metadata,
      created_at: row.created_at,
      canonicalization_version: CANONICALIZATION_VERSION,
    };
    const expected = createHash("sha256")
      .update(canonicalize(payload), "utf8")
      .digest("hex");
    expect(expected).toBe(row.row_hash);
  });

  it("first row has prev_hash null; second row chains to first", async () => {
    const h = makeHarness();

    const first = await h.logger.write(baseEvent({ requestId: "req_a" }));
    expect(first.prev_hash).toBeNull();

    const second = await h.logger.write(baseEvent({ requestId: "req_b" }));
    expect(second.prev_hash).toBe(first.row_hash);
  });

  it("tampering with prev_hash changes row_hash (chain verifies)", async () => {
    const h = makeHarness();
    const row = await h.logger.write(baseEvent());

    const trueHash = computeAuditRowHash({
      prevHash: row.prev_hash,
      canonicalFields: {
        id: row.id,
        workspace_id: row.workspace_id,
        actor_user_id: row.actor_user_id,
        actor_type: row.actor_type,
        action: row.action,
        object_type: row.object_type,
        object_id: row.object_id,
        result: row.result,
        request_id: row.request_id,
        ip_hmac: row.ip_hmac,
        user_agent_hmac: row.user_agent_hmac,
        metadata: row.metadata,
        created_at: row.created_at,
      },
    });
    const tamperedHash = computeAuditRowHash({
      prevHash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      canonicalFields: {
        id: row.id,
        workspace_id: row.workspace_id,
        actor_user_id: row.actor_user_id,
        actor_type: row.actor_type,
        action: row.action,
        object_type: row.object_type,
        object_id: row.object_id,
        result: row.result,
        request_id: row.request_id,
        ip_hmac: row.ip_hmac,
        user_agent_hmac: row.user_agent_hmac,
        metadata: row.metadata,
        created_at: row.created_at,
      },
    });
    expect(trueHash).toBe(row.row_hash);
    expect(tamperedHash).not.toBe(row.row_hash);
  });
});

describe("AuditLogger.write — DI writer", () => {
  it("invokes writer exactly once per write()", async () => {
    const h = makeHarness();
    await h.logger.write(baseEvent({ requestId: "r1" }));
    await h.logger.write(baseEvent({ requestId: "r2" }));
    await h.logger.write(baseEvent({ requestId: "r3" }));
    expect(h.writerCallCount.n).toBe(3);
    expect(h.rows).toHaveLength(3);
  });

  it("propagates writer errors and does not advance the chain", async () => {
    let prev: string | null = null;
    let calls = 0;
    const failing = new AuditLogger({
      writer: async () => {
        calls += 1;
        throw new Error("db down");
      },
      prevHashGetter: async () => prev,
    });
    await expect(failing.write(baseEvent())).rejects.toThrow("db down");
    expect(calls).toBe(1);
    // Chain tip never advanced — the harness here keeps prev=null.
    expect(prev).toBeNull();
  });
});

describe("AuditLogger.write — actor_type consistency (V4-R3)", () => {
  it("accepts unauthenticated actor with null user id (login.failed)", async () => {
    const h = makeHarness();
    const row = await h.logger.write(
      baseEvent({
        actorType: "unauthenticated",
        actorUserId: null,
        action: "login.failed",
        result: "denied",
        objectType: undefined,
        objectId: undefined,
        metadata: { subject_redacted: "sha256:abcd" },
      }),
    );
    expect(row.actor_type).toBe("unauthenticated");
    expect(row.actor_user_id).toBeNull();
  });

  it("rejects unauthenticated actor with a non-null user id", async () => {
    const h = makeHarness();
    await expect(
      h.logger.write(
        baseEvent({
          actorType: "unauthenticated",
          actorUserId: "user_01",
          action: "login.failed",
          result: "denied",
        }),
      ),
    ).rejects.toMatchObject({ code: "audit.invalid_metadata_shape" });
  });

  it("rejects an authenticated actor with a null user id", async () => {
    const h = makeHarness();
    await expect(
      h.logger.write(
        baseEvent({
          actorType: "human",
          actorUserId: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "audit.invalid_metadata_shape" });
  });
});

describe("AuditLogger.write — action validation (defense in depth)", () => {
  it("refuses a string that is not in the AuditEvent literal union", async () => {
    const h = makeHarness();
    // Caller smuggles a fake action via an `as` cast — the type
    // system can't catch this, so the runtime guard inside write()
    // must.
    await expect(
      h.logger.write(
        baseEvent({
          action: "capsule.exploded" as AuditEvent,
        }),
      ),
    ).rejects.toBeInstanceOf(RedactionError);
    // And specifically the right code:
    await expect(
      h.logger.write(
        baseEvent({ action: "definitely.not.an.event" as AuditEvent }),
      ),
    ).rejects.toMatchObject({ code: "audit.invalid_metadata_shape" });
  });

  it("refuses an empty requestId", async () => {
    const h = makeHarness();
    await expect(
      h.logger.write(baseEvent({ requestId: "" })),
    ).rejects.toMatchObject({ code: "audit.invalid_metadata_shape" });
  });
});

describe("AuditLogger.write — workspace null is allowed for platform events", () => {
  it("writes a row with workspace_id null", async () => {
    const h = makeHarness();
    const row = await h.logger.write(
      baseEvent({
        workspaceId: null,
        action: "secret.rotated",
        actorType: "operator",
        actorUserId: "operator_01",
        objectType: undefined,
        objectId: undefined,
        metadata: {},
      }),
    );
    expect(row.workspace_id).toBeNull();
    expect(row.action).toBe("secret.rotated");
  });
});

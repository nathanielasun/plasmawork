import { createHmac } from "node:crypto";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { promotionAuditRoutes } from "../../src/internal/promotionAuditRoutes.js";
import type { AuditLogger } from "../../../../packages/secure_core/src/audit/logger.js";

const SECRET = "i".repeat(64);
const TS = "1778445000";
const BODY = {
  action: "tool.promoted",
  promotion_request_id: "11111111-1111-4111-8111-111111111111",
  actor_user_id: "22222222-2222-4222-8222-222222222222",
  result: "succeeded",
} as const;

function signature(): string {
  const payload = [
    TS,
    BODY.action,
    BODY.promotion_request_id,
    BODY.actor_user_id,
    BODY.result,
  ].join("|");
  return createHmac("sha256", SECRET).update(payload, "utf8").digest("hex");
}

describe("promotionAuditRoutes", () => {
  it("writes a canonical audit event for valid internal signatures", async () => {
    const calls: unknown[] = [];
    const auditLogger = {
      async write(input: unknown) {
        calls.push(input);
        return undefined as never;
      },
    } as unknown as AuditLogger;
    const app = Fastify({ logger: false });
    await app.register(promotionAuditRoutes, {
      auditLogger,
      internalSecret: SECRET,
      now: () => Number.parseInt(TS, 10) * 1000,
    });

    const r = await app.inject({
      method: "POST",
      url: "/internal/audit-events/tool-promotion",
      headers: {
        "content-type": "application/json",
        "x-workbench-internal-audit-timestamp": TS,
        "x-workbench-internal-audit-signature": signature(),
      },
      payload: BODY,
    });

    expect(r.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      action: "tool.promoted",
      objectType: "tool_promotion",
      objectId: BODY.promotion_request_id,
    });
    await app.close();
  });

  it("rejects invalid internal signatures", async () => {
    const auditLogger = {
      async write() {
        throw new Error("must not write");
      },
    } as unknown as AuditLogger;
    const app = Fastify({ logger: false });
    await app.register(promotionAuditRoutes, {
      auditLogger,
      internalSecret: SECRET,
      now: () => Number.parseInt(TS, 10) * 1000,
    });

    const r = await app.inject({
      method: "POST",
      url: "/internal/audit-events/tool-promotion",
      headers: {
        "content-type": "application/json",
        "x-workbench-internal-audit-timestamp": TS,
        "x-workbench-internal-audit-signature": "0".repeat(64),
      },
      payload: BODY,
    });

    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

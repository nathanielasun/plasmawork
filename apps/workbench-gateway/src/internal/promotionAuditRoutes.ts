/**
 * Gateway-internal promotion audit bridge.
 *
 * The Python FastAPI promotion flow cannot import secure_core's
 * TypeScript AuditLogger directly. In gateway-required mode it posts
 * a small HMAC-signed decision event here so promotion request /
 * approval / denial lands in the canonical audit_events hash chain.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";

import type { AuditLogger } from "../../../../packages/secure_core/src/audit/logger.js";
import type {
  AuditEvent,
  AuditResult,
} from "../../../../packages/secure_core/src/config/audit_events.js";

const SIGNATURE_HEADER = "x-workbench-internal-audit-signature";
const TIMESTAMP_HEADER = "x-workbench-internal-audit-timestamp";
const MAX_SKEW_SECONDS = 30;

const BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "promotion_request_id",
    "actor_user_id",
    "result",
  ],
  properties: {
    action: {
      type: "string",
      enum: [
        "tool.promotion_requested",
        "tool.promoted",
        "tool.promotion_denied",
      ],
    },
    promotion_request_id: { type: "string", format: "uuid" },
    actor_user_id: { type: "string", format: "uuid" },
    result: { type: "string", enum: ["succeeded", "denied", "failed"] },
  },
} as const;

interface PromotionAuditBody {
  readonly action: AuditEvent;
  readonly promotion_request_id: string;
  readonly actor_user_id: string;
  readonly result: AuditResult;
}

export interface PromotionAuditRoutesOptions {
  readonly auditLogger: AuditLogger;
  readonly internalSecret: string;
  readonly now?: () => number;
}

function signaturePayload(ts: string, body: PromotionAuditBody): string {
  return [
    ts,
    body.action,
    body.promotion_request_id,
    body.actor_user_id,
    body.result,
  ].join("|");
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function signaturesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export const promotionAuditRoutes: FastifyPluginAsync<
  PromotionAuditRoutesOptions
> = async (app, opts) => {
  const now = opts.now ?? Date.now;

  app.post<{ Body: PromotionAuditBody }>(
    "/internal/audit-events/tool-promotion",
    { schema: { body: BODY_SCHEMA } },
    async (req, reply) => {
      const ts = req.headers[TIMESTAMP_HEADER];
      const signature = req.headers[SIGNATURE_HEADER];
      if (typeof ts !== "string" || typeof signature !== "string") {
        return reply.code(401).send({ error: "missing internal audit signature" });
      }
      const tsSeconds = Number.parseInt(ts, 10);
      if (
        !Number.isInteger(tsSeconds) ||
        Math.abs(Math.floor(now() / 1000) - tsSeconds) > MAX_SKEW_SECONDS
      ) {
        return reply.code(401).send({ error: "stale internal audit signature" });
      }
      const expected = sign(opts.internalSecret, signaturePayload(ts, req.body));
      if (!signaturesEqual(signature, expected)) {
        return reply.code(401).send({ error: "invalid internal audit signature" });
      }

      await opts.auditLogger.write({
        workspaceId: null,
        actorUserId: req.body.actor_user_id,
        actorType: "human",
        action: req.body.action,
        objectType: "tool_promotion",
        objectId: req.body.promotion_request_id,
        result: req.body.result,
        requestId: req.body.promotion_request_id,
        metadata: {},
      });
      return { ok: true };
    },
  );
};

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

// Loopback addresses accepted by the /internal/* gate. The HMAC is the
// primary defense, but defense-in-depth: even if the secret leaks, the
// audit-write bridge is unreachable from anywhere but the same host.
//
// Sibling-bug fix (2026-05-10) to the cross-process audit: previously
// the gateway listened on 0.0.0.0 and /internal/* was reachable from
// any LAN client carrying the secret. With the gateway loopback by
// default AND this allowlist, both defenses must fail for a non-local
// caller to write canonical audit events.
const LOOPBACK_IPS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

function isLoopback(ip: string | null | undefined): boolean {
  if (typeof ip !== "string" || ip.length === 0) return false;
  return LOOPBACK_IPS.has(ip);
}

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
    {
      schema: { body: BODY_SCHEMA },
      // Loopback-only preHandler. The route exists for the colocated
      // FastAPI process to POST canonical audit events through. A
      // non-loopback caller has no business reaching this URL, even
      // with a valid signature; refuse before signature verification
      // so a stolen secret alone cannot fabricate events from off-host.
      preHandler: async (req, reply) => {
        if (!isLoopback(req.ip)) {
          return reply
            .code(403)
            .send({ error: "internal audit route is loopback-only" });
        }
      },
    },
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

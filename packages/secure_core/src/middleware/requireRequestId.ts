/**
 * `requireRequestId` — Phase 0.5 Layer 2.
 *
 * Runs first in the §6.2 chain. Attaches a UUIDv7 to `req.requestId`
 * so every later middleware (audit logger, error handler, structured
 * logs) can correlate without re-parsing headers.
 *
 * Policy:
 *   - If `x-request-id` is present AND a valid UUID, trust it. This
 *     supports request tracing across upstream proxies.
 *   - Otherwise generate a server-side UUIDv7 (sortable; cheaper
 *     log scans than v4).
 *   - Always re-emit the value via the response header so clients can
 *     correlate.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { MiddlewareHandler } from "./compose.js";
import { randomUUID } from "node:crypto";

/** RFC 4122 UUID with any version digit (1–7). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * UUIDv7 generator. Uses `node:crypto.randomUUID()` (RFC 9562
 * v4-only on current Node) and rewrites the version + variant nibbles
 * to v7 with the high-resolution timestamp. The rewrite is local so
 * we don't pull in an extra library.
 */
function uuidV7(): string {
  // 48-bit unix-ms timestamp.
  const ms = Date.now();
  const tsHex = ms.toString(16).padStart(12, "0");

  // Random portion: take v4's last 20 hex chars, swap the version +
  // variant nibbles to 7 / 10xx.
  const v4 = randomUUID().replace(/-/g, "");
  // randB: 4 hex, top nibble forced to 7 (version)
  const randB =
    "7" +
    Math.floor(Math.random() * 0x1000)
      .toString(16)
      .padStart(3, "0");
  // randC: 4 hex, top two bits = 10
  const top = (0x8 + Math.floor(Math.random() * 4)).toString(16);
  const randC =
    top +
    Math.floor(Math.random() * 0x1000)
      .toString(16)
      .padStart(3, "0");
  const randD = v4.slice(20, 32);

  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-${randB}-${randC}-${randD}`;
}

export const requireRequestId: MiddlewareHandler = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const incoming = req.headers["x-request-id"];
  const id = isUuid(incoming) ? incoming : uuidV7();
  req.requestId = id;
  reply.header("x-request-id", id);
};

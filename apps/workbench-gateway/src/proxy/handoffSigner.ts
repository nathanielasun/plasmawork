/**
 * Workbench handoff signer — Phase 0.5 / Phase E (2026-05-09).
 *
 * Computes the HMAC-SHA256 signature the gateway attaches to every
 * forwarded request before it reaches the FastAPI workbench. The
 * Python middleware (`packages/core/src/simworkbench/api/auth_middleware.py`)
 * recomputes the same HMAC and constant-time-compares; spoofed
 * `X-Workbench-*` headers from another colocated process are rejected.
 *
 * The handoff carries:
 *
 *   X-Workbench-User-Id          UUID of the authenticated user
 *   X-Workbench-Workspace-Id     UUID of the resolved workspace
 *   X-Workbench-Workspace-Slug   slug from the gateway URL
 *   X-Workbench-Roles            comma-joined role names
 *   X-Workbench-Request-Id       request-id ↔ pairs the FastAPI log with
 *                                 the gateway's audit row
 *   X-Workbench-Issued-At        unix-seconds; FastAPI rejects deltas > 30s
 *   X-Workbench-Signature        hex(HMAC-SHA256(payload, handoffSecret))
 *
 * Where `payload` is `${user_id}|${workspace_id}|${workspace_slug}|${roles}|${request_id}|${issued_at}`.
 *
 * The pipe is deliberately picked so that any character allowed in a
 * username/UUID/slug/role-name can sit in the payload without
 * delimiter ambiguity. UUIDs are hex+hyphen; slugs are a closed
 * `[A-Za-z0-9_-]` alphabet enforced by the workspace-slug validator
 * (added in this same phase); request-ids are UUIDv7 hex+hyphen.
 *
 * The signer NEVER places a raw secret in the payload. The FastAPI
 * middleware only knows the HMAC key, never the user's password or
 * session token.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const HANDOFF_HEADERS = Object.freeze({
  USER_ID: "x-workbench-user-id",
  WORKSPACE_ID: "x-workbench-workspace-id",
  WORKSPACE_SLUG: "x-workbench-workspace-slug",
  ROLES: "x-workbench-roles",
  REQUEST_ID: "x-workbench-request-id",
  ISSUED_AT: "x-workbench-issued-at",
  SIGNATURE: "x-workbench-signature",
} as const);

/**
 * The 7 forwarded headers, lowercased — useful for tests that assert
 * the gateway sets exactly this set.
 */
export const HANDOFF_HEADER_NAMES: readonly string[] = Object.freeze(
  Object.values(HANDOFF_HEADERS),
);

export interface HandoffPayload {
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly roles: readonly string[];
  readonly requestId: string;
  readonly issuedAtSec: number;
}

/**
 * Build the payload string. Exposed for tests so they can compare
 * the gateway's bytes against the Python middleware's bytes.
 */
export function buildHandoffPayload(p: HandoffPayload): string {
  return [
    p.userId,
    p.workspaceId,
    p.workspaceSlug,
    [...p.roles].sort().join(","),
    p.requestId,
    String(p.issuedAtSec),
  ].join("|");
}

/**
 * Sign a payload with the HMAC key. Returns the hex signature.
 */
export function signHandoffPayload(
  p: HandoffPayload,
  handoffSecret: string,
): string {
  if (typeof handoffSecret !== "string" || handoffSecret.length === 0) {
    throw new Error(
      "signHandoffPayload: handoffSecret must be a non-empty string.",
    );
  }
  const payload = buildHandoffPayload(p);
  return createHmac("sha256", handoffSecret).update(payload).digest("hex");
}

/**
 * Build the full set of 7 forwarded headers. Lowercase keys — Fastify
 * normalizes outbound headers so the case isn't load-bearing, but
 * we pin lowercase to match the Python middleware's expectation.
 */
export function buildHandoffHeaders(
  p: HandoffPayload,
  handoffSecret: string,
): Readonly<Record<string, string>> {
  const signature = signHandoffPayload(p, handoffSecret);
  return Object.freeze({
    [HANDOFF_HEADERS.USER_ID]: p.userId,
    [HANDOFF_HEADERS.WORKSPACE_ID]: p.workspaceId,
    [HANDOFF_HEADERS.WORKSPACE_SLUG]: p.workspaceSlug,
    [HANDOFF_HEADERS.ROLES]: [...p.roles].sort().join(","),
    [HANDOFF_HEADERS.REQUEST_ID]: p.requestId,
    [HANDOFF_HEADERS.ISSUED_AT]: String(p.issuedAtSec),
    [HANDOFF_HEADERS.SIGNATURE]: signature,
  });
}

/**
 * Verify a signature against a payload using constant-time compare.
 * Used by tests that assert the gateway+FastAPI agree on the same
 * HMAC. Production verification lives in the Python middleware.
 */
export function verifyHandoffSignature(
  p: HandoffPayload,
  expectedHex: string,
  handoffSecret: string,
): boolean {
  const computed = signHandoffPayload(p, handoffSecret);
  if (computed.length !== expectedHex.length) return false;
  return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(expectedHex, "hex"));
}

/**
 * Reject payloads issued more than `windowSec` seconds ago. The
 * gateway always issues with `now`, so any drift is the FastAPI
 * middleware's clock vs. the gateway's clock; 30s is generous.
 */
export const HANDOFF_REPLAY_WINDOW_SEC = 30;

export function isWithinReplayWindow(
  issuedAtSec: number,
  nowSec: number,
  windowSec: number = HANDOFF_REPLAY_WINDOW_SEC,
): boolean {
  if (!Number.isFinite(issuedAtSec) || !Number.isFinite(nowSec)) return false;
  const delta = Math.abs(nowSec - issuedAtSec);
  return delta <= windowSec;
}

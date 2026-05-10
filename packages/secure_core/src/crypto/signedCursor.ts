/**
 * HMAC-signed pagination cursors — Phase 0.5 Layer-4 (deferred from
 * the 2026-05-09 F1-F5 audit-fix bundle, closed in this commit).
 *
 * v4 §10.3 + §22.2 require pagination cursors on the audit-events and
 * operator routes to be tamper-evident: a caller MUST NOT be able to
 * forge a cursor that selects rows outside the prior-page boundary.
 * The previous implementation base64-encoded a JSON object verbatim,
 * which round-trips arbitrary `{ created_at, id }` pairs the caller
 * supplied — fine for the common case, broken for an attacker who
 * substitutes another workspace's row id and walks the audit chain
 * sideways.
 *
 * Wire format::
 *
 *     base64( JSON.stringify( { p: <payload>, s: <hex sig> } ) )
 *
 *   - ``p`` — the route's existing keyset payload object (snake_case
 *     fields, JSON-serializable). Same shape as before; a code reviewer
 *     can still see what the cursor points at by base64-decoding.
 *   - ``s`` — hex HMAC-SHA256(canonical(p), secret). The canonicalizer
 *     is JSON.stringify with the keys sorted lexicographically so the
 *     same payload always produces the same signature regardless of
 *     property iteration order.
 *
 * Both encode and decode go through the same canonicalizer so a round-
 * tripped cursor always verifies. The verifier uses ``timingSafeEqual``
 * to defeat timing oracles on the signature compare.
 *
 * The ``CURSOR_DOMAIN`` const is mixed into the HMAC key derivation so
 * an audit-events cursor can never be replayed against the operator
 * routes (different domain → different effective key).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { InputInvalidError } from "../errors/shapes.js";

/**
 * Cursor domains. Each route family supplies its own constant so
 * cursors signed for one route cannot be replayed against another.
 * The string is mixed into the HMAC input as a length-prefixed
 * domain tag.
 */
export type CursorDomain = "audit_events" | "operator_events";

const DOMAIN_TAG_PREFIX = "secure_core.cursor.v1.";

/**
 * Canonicalize a payload object so the same fields always produce the
 * same signature. JSON.stringify with sorted keys is sufficient for
 * the cursor payloads (no nested objects, no arrays of objects). If
 * a future cursor needs deeper canonicalization, swap to
 * ``crypto/jcs.ts``'s canonicalize helper.
 */
function canonicalizePayload(payload: Record<string, unknown>): string {
  const sortedKeys = Object.keys(payload).sort();
  const canonical: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    canonical[k] = payload[k];
  }
  return JSON.stringify(canonical);
}

function computeSignature(
  payload: Record<string, unknown>,
  domain: CursorDomain,
  secret: string,
): string {
  const canonical = canonicalizePayload(payload);
  const tagged = `${DOMAIN_TAG_PREFIX}${domain}|${canonical}`;
  return createHmac("sha256", secret).update(tagged, "utf8").digest("hex");
}

export interface SignedCursorEnvelope {
  /** The route's existing keyset payload, JSON-serializable. */
  readonly p: Record<string, unknown>;
  /** Hex HMAC-SHA256 signature over the canonicalized payload. */
  readonly s: string;
}

/**
 * Encode a payload as a base64-encoded signed cursor.
 *
 * Throws ``Error`` (not ``InputInvalidError``) on a missing secret —
 * that's a programmer error at registration time, not a caller's
 * input problem.
 */
export function encodeSignedCursor(
  payload: Record<string, unknown>,
  domain: CursorDomain,
  secret: string,
): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(
      "encodeSignedCursor: secret must be a non-empty string. The host " +
        "loads it from .env.auth (WORKBENCH_GATEWAY_HANDOFF_SECRET, or " +
        "any other ≥32-byte CSPRNG-generated key) and passes it through " +
        "the route plugin options.",
    );
  }
  const sig = computeSignature(payload, domain, secret);
  // Use the same sorted-key canonicalization on the envelope itself
  // so insertion-order-equivalent payloads produce byte-identical
  // cursors. Without this, two cursors with the same {created_at,
  // id} pair could differ in base64 form depending on which property
  // the caller assigned first.
  const sortedPayloadKeys = Object.keys(payload).sort();
  const canonicalPayload: Record<string, unknown> = {};
  for (const k of sortedPayloadKeys) canonicalPayload[k] = payload[k];
  const envelope: SignedCursorEnvelope = { p: canonicalPayload, s: sig };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

/**
 * Decode + verify a signed cursor. Returns the payload on success;
 * throws ``InputInvalidError`` (with ``field: "cursor"``) on any
 * malformed / tampered input. The error message stays generic so the
 * caller cannot tell whether the b64 was malformed, the JSON was
 * malformed, or the signature didn't verify — the only signal is "the
 * cursor is invalid; ask the server for a fresh one".
 *
 * Why generic: §22.2 anti-enumeration. A cursor is a server-issued
 * token; an attacker who can distinguish "wrong sig" from "wrong b64"
 * learns the verifier's structure.
 */
export function decodeSignedCursor(
  raw: string,
  domain: CursorDomain,
  secret: string,
): Record<string, unknown> {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(
      "decodeSignedCursor: secret must be a non-empty string. See " +
        "encodeSignedCursor for the loading contract.",
    );
  }
  let json: string;
  try {
    json = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new InputInvalidError("Cursor is invalid.", { field: "cursor" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InputInvalidError("Cursor is invalid.", { field: "cursor" });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new InputInvalidError("Cursor is invalid.", { field: "cursor" });
  }
  const envelope = parsed as Record<string, unknown>;
  const payloadRaw = envelope.p;
  const sigRaw = envelope.s;
  if (
    typeof sigRaw !== "string" ||
    typeof payloadRaw !== "object" ||
    payloadRaw === null ||
    Array.isArray(payloadRaw)
  ) {
    throw new InputInvalidError("Cursor is invalid.", { field: "cursor" });
  }
  const payload = payloadRaw as Record<string, unknown>;
  const expected = computeSignature(payload, domain, secret);
  // Constant-time compare. Both strings are hex; equal-length
  // requirement is enforced by ``timingSafeEqual``'s precondition.
  if (sigRaw.length !== expected.length) {
    throw new InputInvalidError("Cursor is invalid.", { field: "cursor" });
  }
  const a = Buffer.from(sigRaw, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (!timingSafeEqual(a, b)) {
    throw new InputInvalidError("Cursor is invalid.", { field: "cursor" });
  }
  return payload;
}

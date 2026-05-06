/**
 * Worker token issuer + verifier — Phase 0.5 Layer 3 task L3.8.
 *
 * v4 §18.1: each worker invocation receives a short-lived scoped
 * credential bound to one run ID. Authorized capabilities (and
 * NOTHING else):
 *
 *   - run.read              (read that run's trusted DB record)
 *   - capsule.read          (read the read-only capsule snapshot)
 *   - run.write_artifact    (write artifacts for that run)
 *   - run.emit_event        (emit run events for that run)
 *
 * Workers MUST NOT access: users, sessions, role_permissions, audit
 * or provenance mutation, other workspaces, other runs.
 *
 * Token shape: `<base64url(payload_json)>.<hex(hmac_sha256(key, payload_json))>`.
 * The payload is canonicalized via L1.2 JCS so byte-equal canonical
 * form drives the HMAC — a worker re-signing with the same payload
 * always produces the same signature, and a 1-bit field flip in the
 * payload yields a different one.
 *
 * Lifecycle:
 *   - Issuance is stateless (no DB row) — the HMAC + the embedded
 *     `expires_at` give us scope and short TTL. Revocation works
 *     via short expiry + an optional revocation list keyed on token
 *     hash (handed to the caller for runs that were cancelled
 *     before the worker reached its deadline).
 *   - Per v4 §18.1, the run state machine drives the actual
 *     "is this run still permitted to run?" check; the token tells
 *     the upload endpoint WHICH run id to scope to, not whether
 *     the run is still active.
 *
 * Capabilities are CLOSED. Issuance refuses to mint with any
 * capability outside the allowlist; verification refuses claims
 * that include an unknown capability.
 */

import { hmacSha256, hmacBufferEqual } from "../crypto/hmac.js";
import { canonicalize } from "../crypto/jcs.js";
import { SecureCoreError } from "../errors/shapes.js";

export const WORKER_CAPABILITIES = [
  "run.read",
  "capsule.read",
  "run.write_artifact",
  "run.emit_event",
] as const;

export type WorkerCapability = (typeof WORKER_CAPABILITIES)[number];

export const WORKER_CAPABILITY_SET: ReadonlySet<WorkerCapability> = Object.freeze(
  new Set(WORKER_CAPABILITIES),
);

export function isWorkerCapability(v: unknown): v is WorkerCapability {
  return typeof v === "string" && WORKER_CAPABILITY_SET.has(v as WorkerCapability);
}

/**
 * Strict claim shape. NEVER includes user identity / session / etc. —
 * the token speaks for the worker, not the human who launched it.
 */
export interface WorkerClaims {
  /** Token id — opaque uuid for revocation. */
  readonly jti: string;
  readonly run_id: string;
  readonly workspace_id: string;
  readonly capsule_id: string;
  readonly capsule_version_id: string;
  /** Closed capability set; every entry must be in `WORKER_CAPABILITIES`. */
  readonly capabilities: ReadonlyArray<WorkerCapability>;
  /** Unix seconds. */
  readonly issued_at: number;
  /** Unix seconds. */
  readonly expires_at: number;
}

export interface IssueTokenOptions {
  readonly hmacKey: Buffer;
  readonly run: {
    readonly id: string;
    readonly workspaceId: string;
    readonly capsuleId: string;
    readonly capsuleVersionId: string;
  };
  /** Override default capabilities (must be a subset of WORKER_CAPABILITIES). */
  readonly capabilities?: ReadonlyArray<WorkerCapability>;
  /** Default 1 hour. Refused if non-positive. */
  readonly ttlSeconds?: number;
  /** UUID source for `jti`. Defaults to `randomUUID`. */
  readonly newJti?: () => string;
  readonly now?: () => number;
}

export interface IssuedWorkerToken {
  readonly raw: string;
  readonly claims: WorkerClaims;
  /** SHA-256 hex of the raw token; suitable for revocation lists. */
  readonly tokenHash: string;
}

const DEFAULT_TTL_SECONDS = 3600;

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function base64UrlDecode(s: string): Buffer | null {
  // Node accepts base64url; reject anything containing standard
  // base64-only chars to keep the format pinned.
  if (/[+/=]/.test(s)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    return Buffer.from(s, "base64url");
  } catch {
    return null;
  }
}

function sha256Hex(value: string): string {
  // Tiny dependency on node:crypto without pulling node:crypto's full
  // surface into this file. Re-exported here for cohesion with the
  // tokenHash semantics.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

export function issueWorkerToken(opts: IssueTokenOptions): IssuedWorkerToken {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error(
      `issueWorkerToken: ttlSeconds must be a positive integer (got ${ttl})`,
    );
  }
  const requested = opts.capabilities ?? [
    "run.read",
    "capsule.read",
    "run.write_artifact",
    "run.emit_event",
  ];
  for (const c of requested) {
    if (!isWorkerCapability(c)) {
      throw new Error(
        `issueWorkerToken: capability "${c}" not in WORKER_CAPABILITIES`,
      );
    }
  }
  const nowSec = Math.floor((opts.now ?? Date.now)() / 1000);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
  const jti = (opts.newJti ?? randomUUID)();

  const claims: WorkerClaims = Object.freeze({
    jti,
    run_id: opts.run.id,
    workspace_id: opts.run.workspaceId,
    capsule_id: opts.run.capsuleId,
    capsule_version_id: opts.run.capsuleVersionId,
    capabilities: Object.freeze([...requested]),
    issued_at: nowSec,
    expires_at: nowSec + ttl,
  });

  const canonical = canonicalize(claims);
  const payload = base64UrlEncode(Buffer.from(canonical, "utf-8"));
  const signature = hmacSha256(opts.hmacKey, canonical);
  const raw = `${payload}.${signature}`;
  return { raw, claims, tokenHash: sha256Hex(raw) };
}

export interface VerifyTokenOptions {
  readonly hmacKey: Buffer;
  readonly raw: string;
  /**
   * The run id the request is operating on. Refusal: the token's
   * `run_id` claim MUST match this exactly. v4 §29 #44 — worker
   * token for run A cannot be used on run B.
   */
  readonly expectedRunId: string;
  /** The capability the route requires; refused if not in the token's claims. */
  readonly requiredCapability: WorkerCapability;
  /** Optional revocation list — token hashes that have been explicitly burned. */
  readonly revokedTokenHashes?: ReadonlySet<string>;
  readonly now?: () => number;
}

export type WorkerTokenRefusalReason =
  | "malformed"
  | "signature_mismatch"
  | "expired"
  | "run_mismatch"
  | "capability_missing"
  | "revoked"
  | "claims_invalid";

export type VerifyResult =
  | { ok: true; claims: WorkerClaims; tokenHash: string }
  | { ok: false; reason: WorkerTokenRefusalReason };

function parseClaims(canonical: string): WorkerClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const c = parsed as Record<string, unknown>;
  if (
    typeof c.jti !== "string" ||
    typeof c.run_id !== "string" ||
    typeof c.workspace_id !== "string" ||
    typeof c.capsule_id !== "string" ||
    typeof c.capsule_version_id !== "string" ||
    !Array.isArray(c.capabilities) ||
    typeof c.issued_at !== "number" ||
    typeof c.expires_at !== "number"
  ) {
    return null;
  }
  for (const cap of c.capabilities) {
    if (!isWorkerCapability(cap)) return null;
  }
  return c as unknown as WorkerClaims;
}

export function verifyWorkerToken(opts: VerifyTokenOptions): VerifyResult {
  const dot = opts.raw.indexOf(".");
  if (dot < 0) return { ok: false, reason: "malformed" };
  const payload = opts.raw.slice(0, dot);
  const signature = opts.raw.slice(dot + 1);
  const decoded = base64UrlDecode(payload);
  if (decoded === null) return { ok: false, reason: "malformed" };
  const canonical = decoded.toString("utf-8");
  const expectedSig = hmacSha256(opts.hmacKey, canonical);
  if (
    expectedSig.length !== signature.length ||
    !hmacBufferEqual(expectedSig, signature)
  ) {
    return { ok: false, reason: "signature_mismatch" };
  }
  const claims = parseClaims(canonical);
  if (claims === null) return { ok: false, reason: "claims_invalid" };
  // Re-canonicalize to guard against payload-form fiddling: if the
  // decoded form is not byte-equal to its own canonicalization, the
  // signature could be valid for one form and the claims valid for
  // another. Canonicalize and refuse on mismatch.
  if (canonicalize(claims) !== canonical) {
    return { ok: false, reason: "claims_invalid" };
  }
  const nowSec = Math.floor((opts.now ?? Date.now)() / 1000);
  if (claims.expires_at <= nowSec) {
    return { ok: false, reason: "expired" };
  }
  if (claims.run_id !== opts.expectedRunId) {
    return { ok: false, reason: "run_mismatch" };
  }
  if (!claims.capabilities.includes(opts.requiredCapability)) {
    return { ok: false, reason: "capability_missing" };
  }
  const tokenHash = sha256Hex(opts.raw);
  if (opts.revokedTokenHashes?.has(tokenHash) ?? false) {
    return { ok: false, reason: "revoked" };
  }
  return { ok: true, claims, tokenHash };
}

/**
 * Throws on rejection. Useful in route handlers that want a single
 * code path. Maps every refusal reason to `WorkerUploadDeniedError`
 * so the §3 envelope returns 403 with the closed reason in details.
 */
export function assertWorkerTokenValid(opts: VerifyTokenOptions): WorkerClaims {
  const r = verifyWorkerToken(opts);
  if (r.ok) return r.claims;
  throw new SecureCoreError(
    "WORKER_UPLOAD_DENIED",
    "Worker token rejected.",
    { reason: r.reason },
  );
}

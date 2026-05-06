/**
 * HTTP mapper — Phase 0.5 Layer-1 (L1.4).
 *
 * Converts a thrown error (a `SecureCoreError` subclass, or any other
 * unknown value) into the §3 envelope and the matching HTTP status. The
 * Fastify `setErrorHandler` calls `toHttpResponse(err, req.id, { dev })`
 * and forwards the result to `reply.code(status).send(body)`. This module
 * has zero HTTP framework dependencies — it returns plain data.
 *
 * Source of truth: `IMPLEMENTATION_MANIFEST.md` §3 status table.
 */

import {
  ERROR_CODES,
  SecureCoreError,
  type ErrorCode,
  type ErrorEnvelope,
} from "./shapes.js";

/**
 * Closed mapping from every `ErrorCode` to its HTTP status code, exactly
 * as pinned in the manifest §3 table. The TypeScript `Record<ErrorCode, ...>`
 * type forces every code to be present; adding a new code to
 * `ERROR_CODES` without a status here is a compile error.
 */
export const ERROR_CODE_TO_HTTP_STATUS: Readonly<Record<ErrorCode, number>> =
  Object.freeze({
    UNAUTHENTICATED: 401,
    SESSION_REVOKED: 401,
    SESSION_EXPIRED: 401,
    SESSION_IDLE_TIMEOUT: 401,
    DISABLED_USER: 401,
    CSRF_FAILED: 403,
    ORIGIN_MISMATCH: 403,
    NOT_FOUND: 404, // uniform-404 invariant per v4 §4.4
    PERMISSION_DENIED: 403, // distinct from NOT_FOUND per v4 §4.4
    APPROVAL_REQUIRED: 403,
    APPROVAL_TOKEN_INVALID: 403,
    APPROVAL_TOKEN_REUSED: 403,
    APPROVAL_CONTEXT_MISMATCH: 403,
    INPUT_INVALID: 400,
    UNEXPECTED_FIELD: 400,
    PATH_INVALID: 400,
    ARCHIVE_REJECTED: 400,
    VERSION_CONFLICT: 409,
    QUOTA_EXCEEDED: 429,
    RATE_LIMITED: 429,
    WORKER_UPLOAD_DENIED: 403,
    SANDBOX_VIOLATION: 500, // intentional opacity per manifest §3
    INTERNAL_ERROR: 500,
  } satisfies Record<ErrorCode, number>);

// Compile-time assertion that the mapping covers exactly the closed set.
// (`satisfies` above gives the structural check; this line guards against
// `ERROR_CODES` and `ERROR_CODE_TO_HTTP_STATUS` drifting at runtime.)
for (const code of ERROR_CODES) {
  if (!(code in ERROR_CODE_TO_HTTP_STATUS)) {
    throw new Error(
      `secure_core/errors: missing HTTP status mapping for code "${code}"`,
    );
  }
}

export interface ToHttpResponseOptions {
  /**
   * When `true`, the unknown-error branch attaches `details.type` (the
   * thrown value's constructor name) to aid debugging. In prod (default),
   * the details field is omitted entirely so the envelope leaks nothing
   * about the underlying failure. The original error's `message` is
   * NEVER copied into the envelope from the unknown branch — only the
   * generic "Internal server error." string is exposed.
   */
  dev?: boolean;
}

export interface HttpResponse {
  status: number;
  body: ErrorEnvelope;
}

const GENERIC_INTERNAL_MESSAGE = "Internal server error.";
const REDACTED_DETAILS: Readonly<Record<string, true>> = Object.freeze({
  redacted: true,
});

const FORBIDDEN_DETAIL_KEY_PARTS = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "session_hash",
  "stack",
  "token",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function detailKeyIsForbidden(key: string): boolean {
  const lowered = key.toLowerCase();
  return FORBIDDEN_DETAIL_KEY_PARTS.some((part) => lowered.includes(part));
}

function cloneSafeDetailValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  const t = typeof value;
  if (t === "string" || t === "boolean") {
    return value;
  }
  if (t === "number") {
    return Number.isFinite(value) ? value : REDACTED_DETAILS;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneSafeDetailValue(item));
  }
  if (!isPlainObject(value)) {
    return REDACTED_DETAILS;
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (detailKeyIsForbidden(key)) {
      return REDACTED_DETAILS;
    }
    const cloned = cloneSafeDetailValue(nested);
    if (cloned === REDACTED_DETAILS) {
      return REDACTED_DETAILS;
    }
    out[key] = cloned;
  }
  return out;
}

/**
 * Expected errors may carry details, but the HTTP boundary still owns
 * the no-leak invariant. A buggy call site that puts token/password/
 * cookie/stack-shaped data into details gets a terse redacted marker
 * instead of a client-visible secret.
 */
export function sanitizeErrorDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const cloned = cloneSafeDetailValue(details);
  if (!isPlainObject(cloned)) {
    return { ...REDACTED_DETAILS };
  }
  return cloned;
}

/**
 * Map an arbitrary thrown value to `{ status, body }`. Always succeeds:
 * unknown values fall through to `INTERNAL_ERROR / 500`.
 *
 * The `requestId` argument is REQUIRED — every envelope carries it and
 * audit rows pivot on it for cross-correlation. Pass `req.id` from the
 * Fastify request scope, never a constructed value.
 */
export function toHttpResponse(
  err: unknown,
  requestId: string,
  opts: ToHttpResponseOptions = {},
): HttpResponse {
  if (err instanceof SecureCoreError) {
    const status = ERROR_CODE_TO_HTTP_STATUS[err.code];
    const inner: ErrorEnvelope["error"] = {
      code: err.code,
      message: err.message,
      request_id: requestId,
    };
    if (err.details !== undefined) {
      inner.details = sanitizeErrorDetails(err.details);
    }
    return { status, body: { error: inner } };
  }

  // Unknown branch — never copy `err.message`, never include stack traces.
  // In dev mode, attach only the constructor name so an operator can grep
  // logs for the originating exception class without leaking internals to
  // a remote caller.
  const inner: ErrorEnvelope["error"] = {
    code: "INTERNAL_ERROR",
    message: GENERIC_INTERNAL_MESSAGE,
    request_id: requestId,
  };
  if (opts.dev === true) {
    const ctorName =
      err && typeof err === "object" && err.constructor
        ? err.constructor.name
        : typeof err;
    inner.details = { type: ctorName };
  }
  return {
    status: ERROR_CODE_TO_HTTP_STATUS.INTERNAL_ERROR,
    body: { error: inner },
  };
}

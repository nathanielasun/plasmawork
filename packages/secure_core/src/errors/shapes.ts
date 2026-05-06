/**
 * Error shape contract — Phase 0.5 Layer-1 (L1.4).
 *
 * Pins the JSON envelope shape and the closed error-code enum used by
 * every error response in `packages/secure_core`. Source of truth:
 * `IMPLEMENTATION_MANIFEST.md` §3 (and `secure_multi_user_scaffolding_plan_v4.md`
 * §4.1 / §4.4 / §16 / §20). Adding a new code requires updating BOTH this
 * file AND the manifest table in the same commit, plus the status mapping
 * in `./mapper.ts`.
 *
 * Envelope:
 *
 * ```json
 * {
 *   "error": {
 *     "code": "VERSION_CONFLICT",
 *     "message": "Capsule update rejected: version is stale.",
 *     "details": { "expected_version_id": "...", "actual_version_id": "..." },
 *     "request_id": "req_01J3QY..."
 *   }
 * }
 * ```
 *
 * `details` is OPTIONAL and MUST NOT contain user input verbatim, secrets,
 * stack traces, or internal identifiers not already known to the caller.
 * `request_id` is REQUIRED on every envelope; it is supplied by the
 * `requestId` middleware and threaded through to `toHttpResponse`.
 */

export const ERROR_CODES = [
  // Authentication / session (401)
  "UNAUTHENTICATED",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "SESSION_IDLE_TIMEOUT",
  "DISABLED_USER",

  // Browser-channel rejections (403, V4-R2)
  "CSRF_FAILED",
  "ORIGIN_MISMATCH",

  // Workspace + authorization (§4.4)
  "NOT_FOUND",
  "PERMISSION_DENIED",

  // Approval (§16)
  "APPROVAL_REQUIRED",
  "APPROVAL_TOKEN_INVALID",
  "APPROVAL_TOKEN_REUSED",
  "APPROVAL_CONTEXT_MISMATCH",

  // Input validation (§4.1)
  "INPUT_INVALID",
  "UNEXPECTED_FIELD",
  "PATH_INVALID",
  "ARCHIVE_REJECTED",

  // Concurrency (§20)
  "VERSION_CONFLICT",

  // Quotas + rate limits (§21, §22)
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",

  // Worker upload + sandbox
  "WORKER_UPLOAD_DENIED",
  "SANDBOX_VIOLATION",

  // Catch-all
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_CODE_SET: ReadonlySet<ErrorCode> = Object.freeze(
  new Set(ERROR_CODES),
);

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" && ERROR_CODE_SET.has(value as ErrorCode)
  );
}

/**
 * The exact envelope every error response carries.
 *
 * The outer single-key wrapper (`{ "error": {...} }`) is intentional: it
 * leaves room for the success envelope (`{ "data": {...} }`) without
 * field-name collision and lets clients discriminate on key presence.
 */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    request_id: string;
  };
}

/**
 * Base class for every error thrown inside `secure_core`. Service-layer
 * code throws subclasses; the Fastify error handler maps them to the
 * §3 envelope via `toHttpResponse` in `./mapper.ts`.
 *
 * The base class supports the rare case of a code that does not have a
 * dedicated subclass (e.g. `SESSION_EXPIRED`); call sites pass the code
 * explicitly: `new SecureCoreError("SESSION_EXPIRED", "...")`.
 */
export class SecureCoreError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    // Forward `cause` per ES2022 Error options bag; preserves stack chain.
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    // Ensure prototype chain works correctly when transpiled.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Helper to define a subclass with a fixed code. The subclass constructor
 * accepts only `(message, details?, cause?)` because the code is the
 * subclass identity.
 */
function makeErrorClass(code: ErrorCode): {
  new (
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown,
  ): SecureCoreError;
} {
  return class extends SecureCoreError {
    constructor(
      message: string,
      details?: Record<string, unknown>,
      cause?: unknown,
    ) {
      super(code, message, details, cause);
    }
  };
}

// Subclasses for every code an L2 / L3 / L4 handler is likely to raise
// directly. The remaining codes (`SESSION_EXPIRED`, `SESSION_IDLE_TIMEOUT`,
// `DISABLED_USER`, `CSRF_FAILED`, `ORIGIN_MISMATCH`, `APPROVAL_TOKEN_REUSED`,
// `APPROVAL_CONTEXT_MISMATCH`) flow through `new SecureCoreError(code, ...)`
// or local helpers in their owning middleware module.

export class UnauthenticatedError extends makeErrorClass("UNAUTHENTICATED") {}
export class SessionRevokedError extends makeErrorClass("SESSION_REVOKED") {}
export class NotFoundError extends makeErrorClass("NOT_FOUND") {}
export class PermissionDeniedError extends makeErrorClass(
  "PERMISSION_DENIED",
) {}
export class ApprovalRequiredError extends makeErrorClass(
  "APPROVAL_REQUIRED",
) {}
export class ApprovalTokenInvalidError extends makeErrorClass(
  "APPROVAL_TOKEN_INVALID",
) {}
export class InputInvalidError extends makeErrorClass("INPUT_INVALID") {}
export class UnexpectedFieldError extends makeErrorClass("UNEXPECTED_FIELD") {}
export class PathInvalidError extends makeErrorClass("PATH_INVALID") {}
export class ArchiveRejectedError extends makeErrorClass("ARCHIVE_REJECTED") {}
export class VersionConflictError extends makeErrorClass("VERSION_CONFLICT") {}
export class QuotaExceededError extends makeErrorClass("QUOTA_EXCEEDED") {}
export class RateLimitedError extends makeErrorClass("RATE_LIMITED") {}
export class WorkerUploadDeniedError extends makeErrorClass(
  "WORKER_UPLOAD_DENIED",
) {}
export class SandboxViolationError extends makeErrorClass(
  "SANDBOX_VIOLATION",
) {}
export class InternalError extends makeErrorClass("INTERNAL_ERROR") {}

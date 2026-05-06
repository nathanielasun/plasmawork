/**
 * L1.4 error shape contract + HTTP mapper tests.
 *
 * Pins:
 *   1. Every `ErrorCode` has a status mapping; every mapped status is a
 *      known HTTP code (sanity).
 *   2. `isErrorCode` narrows correctly.
 *   3. Subclass identity: each subclass extends `SecureCoreError` AND
 *      `Error`; `instanceof` chains resolve.
 *   4. `toHttpResponse` envelope shape for known + unknown errors.
 *   5. Dev mode attaches `details.type` for unknown errors; prod mode
 *      does not.
 *   6. Uniform-404 (§4.4) and permission-denied=403 (§4.4) invariants.
 */
import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ERROR_CODE_SET,
  isErrorCode,
  SecureCoreError,
  UnauthenticatedError,
  SessionRevokedError,
  NotFoundError,
  PermissionDeniedError,
  ApprovalRequiredError,
  ApprovalTokenInvalidError,
  InputInvalidError,
  UnexpectedFieldError,
  PathInvalidError,
  ArchiveRejectedError,
  VersionConflictError,
  QuotaExceededError,
  RateLimitedError,
  WorkerUploadDeniedError,
  SandboxViolationError,
  InternalError,
  type ErrorCode,
  type ErrorEnvelope,
} from "../../src/errors/shapes";
import {
  ERROR_CODE_TO_HTTP_STATUS,
  toHttpResponse,
} from "../../src/errors/mapper";

// Closed set of HTTP statuses that secure_core may emit (per manifest §3).
const KNOWN_HTTP_STATUSES = new Set<number>([400, 401, 403, 404, 409, 429, 500]);

function expectUnique<T>(values: readonly T[]): void {
  expect(new Set(values).size).toBe(values.length);
}

describe("ERROR_CODES", () => {
  it("is non-empty and free of duplicates", () => {
    expect(ERROR_CODES.length).toBeGreaterThan(0);
    expectUnique(ERROR_CODES);
  });

  it("ERROR_CODE_SET agrees with the tuple", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CODE_SET.has(code)).toBe(true);
    }
    expect(ERROR_CODE_SET.size).toBe(ERROR_CODES.length);
  });

  it("isErrorCode narrows correctly", () => {
    for (const code of ERROR_CODES) {
      expect(isErrorCode(code)).toBe(true);
    }
    expect(isErrorCode("not_a_code")).toBe(false);
    expect(isErrorCode("internal_error")).toBe(false); // case sensitive
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(null)).toBe(false);
    expect(isErrorCode(42)).toBe(false);
    expect(isErrorCode({})).toBe(false);
  });

  it("contains every code listed in IMPLEMENTATION_MANIFEST.md §3", () => {
    const required: ErrorCode[] = [
      "UNAUTHENTICATED",
      "SESSION_REVOKED",
      "SESSION_EXPIRED",
      "SESSION_IDLE_TIMEOUT",
      "DISABLED_USER",
      "CSRF_FAILED",
      "ORIGIN_MISMATCH",
      "NOT_FOUND",
      "PERMISSION_DENIED",
      "APPROVAL_REQUIRED",
      "APPROVAL_TOKEN_INVALID",
      "APPROVAL_TOKEN_REUSED",
      "APPROVAL_CONTEXT_MISMATCH",
      "INPUT_INVALID",
      "UNEXPECTED_FIELD",
      "PATH_INVALID",
      "ARCHIVE_REJECTED",
      "VERSION_CONFLICT",
      "QUOTA_EXCEEDED",
      "RATE_LIMITED",
      "WORKER_UPLOAD_DENIED",
      "SANDBOX_VIOLATION",
      "INTERNAL_ERROR",
    ];
    for (const code of required) {
      expect(ERROR_CODE_SET.has(code)).toBe(true);
    }
  });
});

describe("ERROR_CODE_TO_HTTP_STATUS", () => {
  it("has a mapping for every code in ERROR_CODES", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CODE_TO_HTTP_STATUS[code]).toBeTypeOf("number");
    }
  });

  it("every mapped status is a known HTTP status code (sanity)", () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_CODE_TO_HTTP_STATUS[code];
      expect(
        KNOWN_HTTP_STATUSES.has(status),
        `code ${code} mapped to unexpected status ${status}`,
      ).toBe(true);
    }
  });

  it("matches the exact manifest §3 table values", () => {
    const expected: Record<ErrorCode, number> = {
      UNAUTHENTICATED: 401,
      SESSION_REVOKED: 401,
      SESSION_EXPIRED: 401,
      SESSION_IDLE_TIMEOUT: 401,
      DISABLED_USER: 401,
      CSRF_FAILED: 403,
      ORIGIN_MISMATCH: 403,
      NOT_FOUND: 404,
      PERMISSION_DENIED: 403,
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
      SANDBOX_VIOLATION: 500,
      INTERNAL_ERROR: 500,
    };
    for (const code of ERROR_CODES) {
      expect(ERROR_CODE_TO_HTTP_STATUS[code]).toBe(expected[code]);
    }
  });

  it("NOT_FOUND returns 404 (uniform-404 invariant per v4 §4.4)", () => {
    expect(ERROR_CODE_TO_HTTP_STATUS.NOT_FOUND).toBe(404);
  });

  it("PERMISSION_DENIED returns 403 — distinct from NOT_FOUND (v4 §4.4)", () => {
    expect(ERROR_CODE_TO_HTTP_STATUS.PERMISSION_DENIED).toBe(403);
    expect(ERROR_CODE_TO_HTTP_STATUS.PERMISSION_DENIED).not.toBe(
      ERROR_CODE_TO_HTTP_STATUS.NOT_FOUND,
    );
  });
});

describe("SecureCoreError + subclasses", () => {
  it("SecureCoreError is an Error and stores all fields", () => {
    const cause = new Error("upstream");
    const err = new SecureCoreError(
      "VERSION_CONFLICT",
      "stale",
      { expected_version_id: "a", actual_version_id: "b" },
      cause,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SecureCoreError);
    expect(err.code).toBe("VERSION_CONFLICT");
    expect(err.message).toBe("stale");
    expect(err.details).toEqual({
      expected_version_id: "a",
      actual_version_id: "b",
    });
    expect(err.cause).toBe(cause);
  });

  it("SecureCoreError with no details leaves details undefined", () => {
    const err = new SecureCoreError("UNAUTHENTICATED", "no session");
    expect(err.details).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });

  // Subclass coverage: every documented subclass extends both
  // `SecureCoreError` and `Error`, carries its fixed code, and shows up
  // through `instanceof` against both its own class and the base class.
  const SUBCLASSES: ReadonlyArray<{
    ctor: new (
      message: string,
      details?: Record<string, unknown>,
    ) => SecureCoreError;
    code: ErrorCode;
  }> = [
    { ctor: UnauthenticatedError, code: "UNAUTHENTICATED" },
    { ctor: SessionRevokedError, code: "SESSION_REVOKED" },
    { ctor: NotFoundError, code: "NOT_FOUND" },
    { ctor: PermissionDeniedError, code: "PERMISSION_DENIED" },
    { ctor: ApprovalRequiredError, code: "APPROVAL_REQUIRED" },
    { ctor: ApprovalTokenInvalidError, code: "APPROVAL_TOKEN_INVALID" },
    { ctor: InputInvalidError, code: "INPUT_INVALID" },
    { ctor: UnexpectedFieldError, code: "UNEXPECTED_FIELD" },
    { ctor: PathInvalidError, code: "PATH_INVALID" },
    { ctor: ArchiveRejectedError, code: "ARCHIVE_REJECTED" },
    { ctor: VersionConflictError, code: "VERSION_CONFLICT" },
    { ctor: QuotaExceededError, code: "QUOTA_EXCEEDED" },
    { ctor: RateLimitedError, code: "RATE_LIMITED" },
    { ctor: WorkerUploadDeniedError, code: "WORKER_UPLOAD_DENIED" },
    { ctor: SandboxViolationError, code: "SANDBOX_VIOLATION" },
    { ctor: InternalError, code: "INTERNAL_ERROR" },
  ];

  for (const { ctor, code } of SUBCLASSES) {
    it(`${ctor.name} extends SecureCoreError and carries code ${code}`, () => {
      const err = new ctor("boom", { x: 1 });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SecureCoreError);
      expect(err).toBeInstanceOf(ctor);
      expect(err.code).toBe(code);
      expect(err.message).toBe("boom");
      expect(err.details).toEqual({ x: 1 });
      expect(err.name).toBe(ctor.name);
    });
  }
});

describe("toHttpResponse", () => {
  it("maps a SecureCoreError subclass to status + envelope", () => {
    const err = new ApprovalRequiredError("approval needed", {
      action: "expensive_run",
    });
    const res = toHttpResponse(err, "req_xyz");
    expect(res.status).toBe(403);
    expect(res.body).toEqual<ErrorEnvelope>({
      error: {
        code: "APPROVAL_REQUIRED",
        message: "approval needed",
        details: { action: "expensive_run" },
        request_id: "req_xyz",
      },
    });
  });

  it("omits details on the envelope when the error has none", () => {
    const err = new UnauthenticatedError("no session");
    const res = toHttpResponse(err, "req_1");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(res.body.error.message).toBe("no session");
    expect(res.body.error.request_id).toBe("req_1");
    // Strict envelope: when no details were supplied, the field is absent
    // entirely (not present-and-undefined). JSON serializers drop
    // undefined silently, but the test pins the in-memory shape too.
    expect("details" in res.body.error).toBe(false);
  });

  it("maps NotFoundError to 404 (uniform-404 invariant)", () => {
    const res = toHttpResponse(new NotFoundError("not found"), "req_2");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("maps PermissionDeniedError to 403, distinct from 404", () => {
    const res = toHttpResponse(
      new PermissionDeniedError("missing capability"),
      "req_3",
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("maps VersionConflictError with details (manifest example)", () => {
    const err = new VersionConflictError("stale", {
      expected_version_id: "a",
      actual_version_id: "b",
    });
    const res = toHttpResponse(err, "req_4");
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({
      expected_version_id: "a",
      actual_version_id: "b",
    });
  });

  it("maps a plain Error to INTERNAL_ERROR / 500 and does NOT leak its message", () => {
    const res = toHttpResponse(new TypeError("boom"), "req_x");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.request_id).toBe("req_x");
    // Message must be the canonical generic string, never the original.
    expect(res.body.error.message).not.toContain("boom");
    // No details in default/prod mode.
    expect("details" in res.body.error).toBe(false);
  });

  it("dev mode attaches details.type with the constructor name", () => {
    const res = toHttpResponse(new TypeError("boom"), "req_y", { dev: true });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.details).toEqual({ type: "TypeError" });
    // Even in dev mode, the original message is not surfaced to the client.
    expect(res.body.error.message).not.toContain("boom");
  });

  it("default (prod) mode never includes details on the unknown branch", () => {
    const res = toHttpResponse(new TypeError("boom"), "req_z");
    expect("details" in res.body.error).toBe(false);
    const res2 = toHttpResponse(new TypeError("boom"), "req_z2", {
      dev: false,
    });
    expect("details" in res2.body.error).toBe(false);
  });

  it("dev mode handles non-Error thrown values without crashing", () => {
    const res = toHttpResponse("just a string", "req_s", { dev: true });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.details).toEqual({ type: "string" });
  });

  it("threads request_id verbatim onto every envelope", () => {
    const ids = ["req_a", "req_01J3QY", "req_with-dashes_123"];
    for (const id of ids) {
      const known = toHttpResponse(new InternalError("x"), id);
      expect(known.body.error.request_id).toBe(id);
      const unknown = toHttpResponse(new Error("y"), id);
      expect(unknown.body.error.request_id).toBe(id);
    }
  });
});

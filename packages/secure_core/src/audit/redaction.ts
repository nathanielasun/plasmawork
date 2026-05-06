/**
 * Audit metadata redaction — Phase 0.5 Layer-1 (L1.7).
 *
 * v4 §19.4 forbids `metadata: req.body`, tokens, passwords, cookies,
 * authorization headers, raw secrets, and full environment dumps from
 * landing in any of:
 *
 *   audit_events.metadata
 *   provenance_events.metadata
 *   run_events.metadata
 *   operator_events.reason (where applicable)
 *
 * This module is the single, shared redaction gate. The audit logger
 * (`./logger.ts`) calls `redactMetadata` on every event before any
 * canonicalization or hash-chain step runs; a forbidden key fails the
 * write with a typed error rather than silently emitting a redacted
 * row, because v4 §4.2 ("fail closed") applies to the audit boundary
 * itself.
 *
 * The allowlist starts intentionally small. Adding a key is a
 * deliberate decision that requires updating both this constant and
 * the calling code in the same commit; broad metadata fields that
 * come "from the request" (paths, names, free-text reasons) are
 * deliberately not allowlisted here.
 */

/**
 * Set of metadata keys that may appear in `audit_events.metadata` (and
 * the matching field on `provenance_events` / `run_events`). Anything
 * not in this set is rejected at the boundary.
 *
 * Each entry has a documented call site in v4 plus a downstream test:
 *
 *   - `version_id`, `previous_version_id` — capsule.updated /
 *     capsule.forked emit these per §20.
 *   - `target_user_id_redacted` — workspace.member_added emits the
 *     SHA-256 (or HMAC) of the target's user id, never the raw id.
 *   - `target_workspace_id` — operator events (§13.2) name the
 *     workspace they reached into.
 *   - `quota_key`, `bytes_reserved`, `bytes_committed` — quota.* and
 *     storage.reservation.* events (§21).
 *   - `error_code` — denied / failed rows carry the closed-enum code
 *     from `src/errors/shapes.ts`.
 *   - `archive_reason` — archive.entry_rejected per §29 #15 / V4-R1.
 *   - `denied_reason` — worker.upload_denied per ADR-0012 step 8.
 *   - `count` — bulk events that aggregate (e.g. session.idle_timeout
 *     sweeping N sessions in one run).
 *   - `subject_redacted` — login.failed / approval.* events that need
 *     to identify a subject without leaking the raw user identifier.
 *   - `endpoint` — request.unexpected_field carries the route that
 *     refused the body, not the body itself.
 *
 * Notably absent: `email`, `username`, `path`, `cwd`, `command`,
 * `headers`, `body`, `env`, `args`, `query`, `cookie_*`, anything
 * shaped like a URL. These are in the forbidden set if they appear
 * verbatim, but more importantly they are not allowlisted at all —
 * an absent key is rejected before the forbidden-value scan runs.
 */
export const METADATA_ALLOWLIST: ReadonlySet<string> = Object.freeze(
  new Set([
    "version_id",
    "previous_version_id",
    "target_user_id_redacted",
    "target_workspace_id",
    "quota_key",
    "bytes_reserved",
    "bytes_committed",
    "error_code",
    "archive_reason",
    "denied_reason",
    "count",
    "subject_redacted",
    "endpoint",
  ]),
);

/**
 * Keys whose presence — at any level — indicates a `req.body` /
 * headers leak. This is deliberately a different list from the
 * allowlist: even if a future allowlist entry shadowed one of these
 * names, a value posted under it from an HTTP request body would
 * still be refused. v4 §19.4 plus the §4.1 forbidden-body list.
 *
 * The check is case-insensitive (HTTP header names commonly differ in
 * case from JS property names).
 */
export const FORBIDDEN_VALUE_KEYS: ReadonlySet<string> = Object.freeze(
  new Set([
    // §19.4 explicit
    "password",
    "cookie",
    "authorization",
    "token",
    "secret",
    // §4.1 forbidden body — anything that should be server-derived
    "session_hash",
    "token_hash",
    "row_hash",
    "prev_hash",
    "user_id",
    "actor_id",
    "created_by",
    "updated_by",
    "approved_by",
    "decided_by",
    "workspace_role",
    "role_id",
    "current_version_id",
    "storage_path",
    "disabled_at",
    "assurance_level",
    "auth_method",
    // Common HTTP-y leakage shapes
    "set-cookie",
    "x-approval-token",
  ]),
);

const FORBIDDEN_VALUE_KEYS_LOWER: ReadonlySet<string> = Object.freeze(
  new Set([...FORBIDDEN_VALUE_KEYS].map((k) => k.toLowerCase())),
);

export type RedactionErrorCode =
  | "audit.disallowed_metadata_key"
  | "audit.forbidden_value"
  | "audit.invalid_metadata_shape";

/**
 * Redaction-boundary refusal. The logger turns any of these into a
 * fail-closed audit-write rejection rather than emitting a partial
 * row. The `code` is closed-enum so callers can branch on it.
 */
export class RedactionError extends Error {
  public readonly code: RedactionErrorCode;

  public constructor(code: RedactionErrorCode, message: string) {
    super(message);
    this.name = "RedactionError";
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Walk a value tree and refuse any nested key whose name appears in
 * the forbidden set, regardless of case. This catches "metadata is
 * really a snapshot of req.body" — a single forbidden-named key
 * anywhere in the tree fails the write.
 */
function assertNoForbiddenNestedKeys(value: unknown, path: string): void {
  if (value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertNoForbiddenNestedKeys(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  // Refuse exotic objects up front: a Map / Set / Date / class
  // instance has no place in audit metadata. The canonicalizer would
  // also refuse, but we want a redaction-coded refusal here.
  if (!isPlainObject(value)) {
    throw new RedactionError(
      "audit.invalid_metadata_shape",
      `nested non-plain object at ${path}; metadata may only contain JSON-shaped values`,
    );
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_VALUE_KEYS_LOWER.has(key.toLowerCase())) {
      throw new RedactionError(
        "audit.forbidden_value",
        `forbidden field name "${key}" at ${path}.${key}; v4 §19.4 disallows tokens / passwords / cookies / authorization / session hashes in audit metadata`,
      );
    }
    assertNoForbiddenNestedKeys(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
  }
}

/**
 * Redact a metadata object before it lands in the audit hash chain.
 *
 *   - Refuses any non-plain-object input (`null`, arrays, class
 *     instances) with `audit.invalid_metadata_shape`.
 *   - Refuses any top-level key not in `METADATA_ALLOWLIST` with
 *     `audit.disallowed_metadata_key`. The expansion path is "add
 *     the key to the constant in a separate commit", not "pass
 *     through anything".
 *   - Refuses any nested key (at any depth) whose name appears in
 *     `FORBIDDEN_VALUE_KEYS` with `audit.forbidden_value`. This is
 *     defense-in-depth: a future allowlist key whose value is a JSON
 *     blob still cannot smuggle a `password` or `session_hash`.
 *
 * The function returns a fresh shallow-copied object — Layer-3
 * writers must not assume the input is the same reference they pass
 * in (in case future versions strip rather than reject).
 */
export function redactMetadata(metadata: unknown): Record<string, unknown> {
  if (!isPlainObject(metadata)) {
    throw new RedactionError(
      "audit.invalid_metadata_shape",
      `metadata must be a plain object; got ${
        metadata === null
          ? "null"
          : Array.isArray(metadata)
            ? "array"
            : typeof metadata
      }`,
    );
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(metadata)) {
    if (!METADATA_ALLOWLIST.has(key)) {
      throw new RedactionError(
        "audit.disallowed_metadata_key",
        `metadata key "${key}" is not in the allowlist; add it to METADATA_ALLOWLIST in a deliberate commit if it is genuinely needed`,
      );
    }
    const value = metadata[key];
    // Top-level forbidden-name shadow check (in case a future
    // allowlist entry collides with a forbidden header name).
    if (FORBIDDEN_VALUE_KEYS_LOWER.has(key.toLowerCase())) {
      throw new RedactionError(
        "audit.forbidden_value",
        `top-level key "${key}" is forbidden by v4 §19.4 even when allowlisted; remove it from METADATA_ALLOWLIST`,
      );
    }
    assertNoForbiddenNestedKeys(value, `$.${key}`);
    out[key] = value;
  }
  return out;
}

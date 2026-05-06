/**
 * JCS (RFC 8785) canonicalization wrapper — Phase 0.5 Layer-1 (L1.2).
 *
 * Thin, validating wrapper over `@truestamp/canonify`. The downstream
 * library accepts a few JS values that v4 §19.3 forbids:
 *
 *  - `NaN` / `Infinity` / `-Infinity` — `JSON.stringify` emits `null`
 *    for these, which silently corrupts a hash chain that should fail
 *    closed. RFC 8785 disallows non-finite numbers.
 *  - `BigInt` — no canonical RFC 8785 mapping (the library throws, but
 *    we throw earlier with our own typed error).
 *  - `undefined` values inside an object — the library silently drops
 *    them; that is fine for vanilla JSON but breaks "the canonical form
 *    of input X is unique" because `{a:1}` and `{a:1,b:undefined}`
 *    would collide.
 *  - `Date`, `Map`, `Set`, functions, symbols inside the tree — these
 *    have non-portable serializations across JCS implementations; the
 *    spec requires them to be pre-converted at the call site.
 *
 * Callers reach for a single function:
 *
 *     import { canonicalize, CANONICALIZATION_VERSION } from "./jcs.js";
 *     const s = canonicalize({ b: 1, a: 2 }); // '{"a":2,"b":1}'
 *
 * The version string is the same literal stored in the `audit_events`,
 * `provenance_events`, and `operator_events` tables' default
 * `canonicalization_version` column (v4 §12), so a Layer-3 reader can
 * dispatch by string equality.
 *
 * Source: v4 §19.3 (Hash Chain and External Anchor) and the V4-R9
 * cross-implementation parity requirement.
 */

import { canonify } from "@truestamp/canonify";

/**
 * Pinned canonicalization version. Matches the SQL default in v4 §12
 * for every hash-chained log table. Bumping this requires writing a
 * forward-only migration that re-canonicalizes existing rows and adds
 * a parity fixture under `test/security/`.
 */
export const CANONICALIZATION_VERSION = "jcs-v1" as const;

/**
 * Error class for refusals at the canonicalization boundary. Two codes:
 *
 *  - `jcs.invalid_input`  — value is structurally JSON-shaped but
 *    contains a forbidden numeric (NaN / Infinity / -Infinity) or an
 *    `undefined` inside an object.
 *  - `jcs.unsupported_type` — value contains a runtime type with no
 *    canonical RFC 8785 mapping (BigInt, Date, Map, Set, function,
 *    symbol). Convert at the call site (e.g. `Date → ISO string`)
 *    rather than asking this layer to guess.
 */
export class JcsError extends Error {
  public readonly code: "jcs.invalid_input" | "jcs.unsupported_type";

  public constructor(
    code: "jcs.invalid_input" | "jcs.unsupported_type",
    message: string,
  ) {
    super(message);
    this.name = "JcsError";
    this.code = code;
  }
}

/**
 * Pre-walk the input tree and refuse anything the wrapper forbids.
 * Path is reported in the error message so a caller debugging a row
 * knows exactly which field tripped the check.
 */
function assertCanonicalizable(value: unknown, path: string): void {
  // null is fine (RFC 8785 maps it to literal `null`).
  if (value === null) {
    return;
  }

  const t = typeof value;

  if (t === "undefined") {
    throw new JcsError(
      "jcs.invalid_input",
      `undefined is not a canonicalizable value at ${path}`,
    );
  }

  if (t === "bigint") {
    throw new JcsError(
      "jcs.unsupported_type",
      `BigInt has no RFC 8785 mapping at ${path}; convert to string upstream`,
    );
  }

  if (t === "function" || t === "symbol") {
    throw new JcsError(
      "jcs.unsupported_type",
      `${t} has no RFC 8785 mapping at ${path}`,
    );
  }

  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new JcsError(
        "jcs.invalid_input",
        `non-finite number (${String(value)}) is not canonicalizable at ${path}`,
      );
    }
    return;
  }

  if (t === "string" || t === "boolean") {
    return;
  }

  // From here on, t === "object".
  if (value instanceof Date) {
    throw new JcsError(
      "jcs.unsupported_type",
      `Date instance at ${path}; convert to RFC 3339 UTC string upstream`,
    );
  }

  if (value instanceof Map || value instanceof Set) {
    const ctor = value instanceof Map ? "Map" : "Set";
    throw new JcsError(
      "jcs.unsupported_type",
      `${ctor} instance at ${path}; convert to plain object/array upstream`,
    );
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertCanonicalizable(value[i], `${path}[${i}]`);
    }
    return;
  }

  // Treat any other object with a `toJSON` method as a refusal class:
  // its serialization is opaque to JCS and would diverge across
  // implementations. Plain objects don't have `toJSON`.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new JcsError(
      "jcs.unsupported_type",
      `non-plain object (${(proto?.constructor?.name as string) ?? "unknown"}) at ${path}; convert to a plain object upstream`,
    );
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    assertCanonicalizable(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
  }
}

/**
 * Canonicalize an arbitrary JSON-shaped value into its RFC 8785 byte
 * string. Throws `JcsError` for any input the wrapper refuses (see the
 * class doc for the catalog).
 *
 * The output is a UTF-8 string ready to be HMAC'd or hashed; callers
 * should not re-stringify it.
 */
export function canonicalize(value: unknown): string {
  assertCanonicalizable(value, "$");
  const result = canonify(value);
  // `canonify` is typed `string | undefined`; in practice it returns a
  // string for every input we accept (we already refused `undefined`
  // at the root via `assertCanonicalizable`). Belt-and-suspenders:
  if (typeof result !== "string") {
    throw new JcsError(
      "jcs.invalid_input",
      "canonify returned non-string; this should not happen for accepted input",
    );
  }
  return result;
}

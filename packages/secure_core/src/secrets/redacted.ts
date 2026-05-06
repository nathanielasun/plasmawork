/**
 * RedactedSecret — Phase 0.5 Layer-1 (L1.6).
 *
 * A wrapper around a secret string that refuses to surface the
 * cleartext through any of the three implicit-coercion entry points:
 *   - `toString()`        — string interpolation, template literals
 *   - `[Symbol.toPrimitive]()` — `+`, equality, ordering, etc.
 *   - `toJSON()`          — `JSON.stringify`, structured loggers
 *
 * Cleartext only comes back through the explicit `reveal()` call site,
 * which is the audit point. Calling code should keep `RedactedSecret`
 * instances around and pass them through as long as possible — the
 * later `reveal()` happens, the smaller the blast radius if a logger
 * accidentally captures the value before it's revealed.
 *
 * ADR-0011 §Decision and v4 §19.4 (Logging Hygiene) require that
 * secret values never appear in log output. This class is the
 * structural enforcement; logger-side redaction is defense in depth.
 */

import type { SecretName } from "./allowlist.js";

export class RedactedSecret {
  /**
   * The secret value in cleartext. Private so external code cannot
   * reach it without going through `reveal()`. The `#`-prefixed name
   * makes it a true private field (ECMAScript-level, not just a
   * TypeScript convention) so `JSON.stringify` and runtime reflection
   * cannot enumerate it either.
   */
  readonly #value: string;

  /**
   * The allowlist-checked name of the secret. Carried with the
   * instance so the redaction marker mentions which secret was elided
   * (`<redacted:db.password.app>`), which is enough context for
   * debugging without leaking the value.
   */
  readonly name: SecretName | string;

  constructor(value: string, name: SecretName | string) {
    this.#value = value;
    this.name = name;
  }

  /**
   * The single audited code path that surfaces cleartext. Every call
   * site that calls this should be reviewable; prefer passing the
   * `RedactedSecret` instance through as far as the architecture
   * allows.
   */
  reveal(): string {
    return this.#value;
  }

  /**
   * String coercion (`String(s)`, `${s}`, `s + ""`).
   */
  toString(): string {
    return `<redacted:${this.name}>`;
  }

  /**
   * Implicit primitive coercion. Covers `+`, `==`, ordering, and any
   * other path that goes through `Symbol.toPrimitive`.
   */
  [Symbol.toPrimitive](_hint: string): string {
    return `<redacted:${this.name}>`;
  }

  /**
   * `JSON.stringify` consults `toJSON` before serializing an object.
   * Returning the redaction marker means `JSON.stringify({ s })`
   * produces `'{"s":"<redacted:...>"}'` — never the cleartext.
   */
  toJSON(): string {
    return `<redacted:${this.name}>`;
  }
}

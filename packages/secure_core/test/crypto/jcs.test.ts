/**
 * L1.2 JCS canonicalization wrapper — behavior tests.
 *
 * Pins:
 *   1. Determinism + key sort (RFC 8785 lexicographic UTF-16 keys).
 *   2. Number serialization (no exponent for typical floats; integer
 *      preserves no decimal).
 *   3. String + unicode escaping.
 *   4. Refusal catalog: NaN, ±Infinity, BigInt, undefined inside an
 *      object, Date, Map, Set — each with the right `code`.
 *   5. Cross-implementation parity probe against a fixture byte string.
 *
 * The cross-language fixture in §29 #83 (v4-R9) ships in a later
 * Layer-3 task; this file holds the JS-side parity probe.
 */
import { describe, expect, it } from "vitest";
import {
  CANONICALIZATION_VERSION,
  canonicalize,
  JcsError,
} from "../../src/crypto/jcs";

describe("CANONICALIZATION_VERSION", () => {
  it("matches the v4 §12 schema default literal", () => {
    expect(CANONICALIZATION_VERSION).toBe("jcs-v1");
  });
});

describe("canonicalize", () => {
  it("returns '{}' for an empty object", () => {
    expect(canonicalize({})).toBe("{}");
  });

  it("returns '[]' for an empty array", () => {
    expect(canonicalize([])).toBe("[]");
  });

  it("sorts object keys lexicographically", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys at every level of a nested object", () => {
    const out = canonicalize({
      z: { y: 1, x: 2 },
      a: { d: { c: 3, b: 4 } },
    });
    expect(out).toBe('{"a":{"d":{"b":4,"c":3}},"z":{"x":2,"y":1}}');
  });

  it("preserves array order (arrays are ordered, not sorted)", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("serializes integers without a decimal", () => {
    expect(canonicalize(1)).toBe("1");
    expect(canonicalize({ n: 42 })).toBe('{"n":42}');
  });

  it("serializes typical finite floats without an exponent", () => {
    expect(canonicalize(0.5)).toBe("0.5");
    expect(canonicalize({ n: 0.5 })).toBe('{"n":0.5}');
  });

  it("escapes embedded double quotes", () => {
    expect(canonicalize({ x: '"' })).toBe('{"x":"\\""}');
  });

  it("escapes backslashes and control characters", () => {
    expect(canonicalize({ x: "\\" })).toBe('{"x":"\\\\"}');
    expect(canonicalize({ x: "\n" })).toBe('{"x":"\\n"}');
  });

  it("preserves unicode characters in strings", () => {
    // 'café' = c, a, f, U+00E9 (precomposed e-acute). RFC 8785 emits
    // the UTF-8 sequence directly (not a \u escape) for codepoints
    // outside the JSON escape set.
    expect(canonicalize({ x: "café" })).toBe('{"x":"café"}');
  });

  it("emits true/false/null literals", () => {
    expect(canonicalize({ a: true, b: false, c: null })).toBe(
      '{"a":true,"b":false,"c":null}',
    );
  });

  it("is deterministic across two calls on the same input", () => {
    const input = {
      z: [3, 1, 2],
      m: { p: "x", a: null, k: 0.25 },
      a: 1,
    };
    expect(canonicalize(input)).toBe(canonicalize(input));
  });

  it("matches a fixed canonical byte string (parity probe)", () => {
    const input = { z: { k: "v" }, b: [1, 2, 3], a: 1 };
    expect(canonicalize(input)).toBe('{"a":1,"b":[1,2,3],"z":{"k":"v"}}');
  });
});

describe("canonicalize — refusal catalog", () => {
  function expectJcs(
    fn: () => unknown,
    code: JcsError["code"],
  ): void {
    let caught: unknown;
    try {
      fn();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(JcsError);
    expect((caught as JcsError).code).toBe(code);
  }

  it("refuses NaN at the root", () => {
    expectJcs(() => canonicalize(NaN), "jcs.invalid_input");
  });

  it("refuses NaN inside an object", () => {
    expectJcs(() => canonicalize({ x: NaN }), "jcs.invalid_input");
  });

  it("refuses Infinity", () => {
    expectJcs(() => canonicalize(Infinity), "jcs.invalid_input");
    expectJcs(() => canonicalize({ x: Infinity }), "jcs.invalid_input");
  });

  it("refuses -Infinity", () => {
    expectJcs(() => canonicalize(-Infinity), "jcs.invalid_input");
    expectJcs(() => canonicalize({ x: -Infinity }), "jcs.invalid_input");
  });

  it("refuses undefined at the root", () => {
    expectJcs(() => canonicalize(undefined), "jcs.invalid_input");
  });

  it("refuses undefined inside an object", () => {
    expectJcs(
      () => canonicalize({ a: 1, b: undefined }),
      "jcs.invalid_input",
    );
  });

  it("refuses undefined inside an array", () => {
    expectJcs(() => canonicalize([1, undefined, 2]), "jcs.invalid_input");
  });

  it("refuses Date instances", () => {
    expectJcs(
      () => canonicalize({ ts: new Date("2026-01-01T00:00:00Z") }),
      "jcs.unsupported_type",
    );
  });

  it("refuses BigInt literals", () => {
    expectJcs(() => canonicalize({ n: 1n }), "jcs.unsupported_type");
    expectJcs(() => canonicalize(1n), "jcs.unsupported_type");
  });

  it("refuses Map instances", () => {
    expectJcs(
      () => canonicalize({ m: new Map([["k", "v"]]) }),
      "jcs.unsupported_type",
    );
  });

  it("refuses Set instances", () => {
    expectJcs(
      () => canonicalize({ s: new Set([1, 2]) }),
      "jcs.unsupported_type",
    );
  });

  it("refuses functions inside objects", () => {
    expectJcs(
      () => canonicalize({ f: () => 1 }),
      "jcs.unsupported_type",
    );
  });

  it("refuses symbols inside objects", () => {
    expectJcs(
      () => canonicalize({ s: Symbol("x") }),
      "jcs.unsupported_type",
    );
  });

  it("reports a path in the error message for nested rejections", () => {
    try {
      canonicalize({ outer: { inner: NaN } });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(JcsError);
      expect((err as JcsError).message).toContain("outer");
      expect((err as JcsError).message).toContain("inner");
    }
  });
});

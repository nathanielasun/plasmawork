/**
 * L2.10/L2.11 shared component-validator tests.
 *
 * Pins every §9.4.5–§9.4.10 boundary case so the path builder and
 * archive extractor both behave consistently. Specifically tests the
 * §9.4.10 single-character vs multi-character regex split — a "looks
 * correct" implementation that drops the single-char alternative
 * would silently accept `-` and `.`.
 */

import { describe, it, expect } from "vitest";
import {
  classifyComponent,
  classifyRelativePath,
  isValidComponent,
} from "../../src/paths/components.js";

describe("classifyComponent — §9.4 component-level rules", () => {
  describe("§9.4.5 NUL bytes", () => {
    it.each([
      ["null prefix", "\0evil"],
      ["null suffix", "evil\0"],
      ["null middle", "ev\0il"],
    ])("rejects %s", (_label, input) => {
      expect(classifyComponent(input)).toBe("nul_byte");
    });
  });

  describe("§9.4.6 percent-encoded separators", () => {
    it.each([
      ["%2f literal", "foo%2fbar"],
      ["%2F uppercase", "foo%2Fbar"],
      ["%5c backslash", "foo%5cbar"],
      ["%5C backslash uppercase", "foo%5Cbar"],
    ])("rejects %s", (_label, input) => {
      expect(classifyComponent(input)).toBe("percent_encoded_separator");
    });
  });

  it("§9.4.7 rejects empty component", () => {
    expect(classifyComponent("")).toBe("empty");
  });

  it.each([".", ".."])("§9.4.8 rejects %s", (input) => {
    expect(classifyComponent(input)).toBe("dot_or_dotdot");
  });

  describe("§9.4.9 leading dot / trailing dot / trailing space", () => {
    it.each([".env", ".hidden", ".bashrc"])("rejects leading-dot %s", (n) => {
      expect(classifyComponent(n)).toBe("leading_dot");
    });
    it("rejects trailing dot", () => {
      expect(classifyComponent("foo.")).toBe("trailing_dot_or_space");
    });
    it("rejects trailing space", () => {
      expect(classifyComponent("foo ")).toBe("trailing_dot_or_space");
    });
  });

  describe("§9.4.10 regex enforcement", () => {
    // Single-character clause: only [A-Za-z0-9_] permitted.
    it.each([
      ["letter", "a"],
      ["uppercase", "Z"],
      ["digit", "0"],
      ["underscore", "_"],
    ])("accepts single-char %s", (_l, n) => {
      expect(classifyComponent(n)).toBeNull();
    });

    it.each([
      ["dash alone", "-"],
      ["dot alone — caught earlier as dot_or_dotdot", "."],
    ])("single-char rejection: %s", (_label, input) => {
      const r = classifyComponent(input);
      // Either way it's rejected; we just want NOT-null.
      expect(r).not.toBeNull();
    });

    it.each([
      ["leading dash", "-foo"],
      ["leading dot", ".foo"], // caught by leading-dot rule first
    ])("rejects %s (cannot start with non-alnum/underscore)", (_l, n) => {
      const r = classifyComponent(n);
      expect(r).not.toBeNull();
    });

    it("accepts well-formed multi-char names", () => {
      for (const ok of [
        "abc",
        "snake_case",
        "kebab-case",
        "v1.2.3",
        "module_42",
        "name-with-hyphens",
        "_leading_underscore",
      ]) {
        expect(classifyComponent(ok), `expected ${ok} valid`).toBeNull();
      }
    });

    it("rejects names with disallowed punctuation", () => {
      for (const bad of [
        "a/b", // slash inside component
        "a\\b", // backslash inside component
        "a:b",
        "a*b",
        "a b", // space mid-name
        "a@b",
        "a#b",
      ]) {
        expect(
          classifyComponent(bad),
          `expected ${bad} invalid`,
        ).toBe("regex_mismatch");
      }
    });

    it("isValidComponent agrees with classifyComponent", () => {
      expect(isValidComponent("good")).toBe(true);
      expect(isValidComponent("..")).toBe(false);
      expect(isValidComponent(".env")).toBe(false);
    });
  });
});

describe("classifyRelativePath", () => {
  it("returns null for clean relative paths", () => {
    expect(classifyRelativePath("a/b/c")).toBeNull();
    expect(classifyRelativePath("simulation_capsules/foo/bar")).toBeNull();
  });

  it("rejects absolute paths", () => {
    expect(classifyRelativePath("/etc/passwd")?.reason).toBe("empty");
    expect(classifyRelativePath("\\windows\\system32")?.reason).toBe("empty");
  });

  it("returns the first failing component", () => {
    const r = classifyRelativePath("good/../bad");
    expect(r).not.toBeNull();
    expect(r!.component).toBe("..");
    expect(r!.reason).toBe("dot_or_dotdot");
  });

  it("rejects whole-path NUL bytes", () => {
    expect(classifyRelativePath("a/b\0c")?.reason).toBe("nul_byte");
  });

  it("rejects whole-path percent-encoded separators", () => {
    expect(classifyRelativePath("a%2fb")?.reason).toBe(
      "percent_encoded_separator",
    );
  });

  it("rejects zip-slip ../ traversal at any depth", () => {
    expect(classifyRelativePath("../etc")?.reason).toBe("dot_or_dotdot");
    expect(classifyRelativePath("a/../etc")?.reason).toBe("dot_or_dotdot");
    expect(classifyRelativePath("a/b/../../etc")?.reason).toBe(
      "dot_or_dotdot",
    );
  });
});

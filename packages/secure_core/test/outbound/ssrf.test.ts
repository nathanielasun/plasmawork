/**
 * L3.10 — SSRF guard tests.
 *
 * Pure-logic. Resolver is injected so every classification branch
 * fires deterministically without DNS round-trips.
 */

import { describe, it, expect } from "vitest";

import {
  SsrfGuard,
  classifyIp,
  type LookupAddress,
  type Resolver,
} from "../../src/outbound/ssrf.js";
import { SecureCoreError } from "../../src/errors/shapes.js";

function fixedResolver(ip: string, family: 4 | 6 = 4): Resolver {
  return async () => ({ address: ip, family } satisfies LookupAddress);
}

describe("classifyIp", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["0.0.0.0", "unspecified_address"],
    ["169.254.1.1", "link_local"],
    ["10.0.0.5", "private_range"],
    ["10.255.255.255", "private_range"],
    ["172.16.0.1", "private_range"],
    ["172.31.255.254", "private_range"],
    ["172.32.0.1", null], // NOT private — outside RFC1918
    ["192.168.1.1", "private_range"],
    ["100.64.0.1", "private_range"], // CGN
    ["169.254.169.254", "metadata_service"],
    ["169.254.170.2", "metadata_service"],
    ["100.100.100.200", "metadata_service"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
    ["8.8.8.8", null],
    ["1.1.1.1", null],
  ])("classifyIp(%s) → %s", (ip, expected) => {
    expect(classifyIp(ip)).toBe(expected);
  });

  it.each([
    ["::1", "loopback"],
    ["::", "unspecified_address"],
    ["fe80::1", "link_local"],
    ["feb0::1", "link_local"], // fe80::/10 covers fe8x / fe9x / feax / febx
    ["fec0::1", null], // fec0::/10 is deprecated site-local — not link-local; leave to allowlist
    ["fc00::1", "ipv6_ula"],
    ["fd12:3456::1", "ipv6_ula"],
    ["ff02::1", "multicast"],
    ["::ffff:127.0.0.1", "loopback"], // IPv4-mapped → reclassified
    ["::ffff:10.0.0.1", "private_range"],
    ["::ffff:8.8.8.8", null],
    ["2001:4860:4860::8888", null], // Google public DNS
  ])("classifyIp(%s) [v6] → %s", (ip, expected) => {
    expect(classifyIp(ip)).toBe(expected);
  });

  it("returns resolver_failure for malformed input", () => {
    expect(classifyIp("not-an-ip")).toBe("resolver_failure");
    expect(classifyIp("999.999.999.999")).toBe("resolver_failure");
  });
});

describe("SsrfGuard.validateUrl", () => {
  it("rejects non-http/https schemes", async () => {
    const g = new SsrfGuard({ resolver: fixedResolver("8.8.8.8") });
    await expect(g.validateUrl("file:///etc/passwd")).rejects.toMatchObject({
      details: { reason: "scheme_not_allowed" },
    });
    await expect(g.validateUrl("ftp://example.com/")).rejects.toMatchObject({
      details: { reason: "scheme_not_allowed" },
    });
    await expect(g.validateUrl("javascript:alert(1)")).rejects.toBeInstanceOf(
      SecureCoreError,
    );
  });

  it("accepts public IPv4 host", async () => {
    const g = new SsrfGuard({ resolver: fixedResolver("8.8.8.8") });
    const r = await g.validateUrl("https://example.com/path");
    expect(r.ip).toBe("8.8.8.8");
    expect(r.family).toBe(4);
  });

  it("rejects loopback after DNS resolution", async () => {
    const g = new SsrfGuard({ resolver: fixedResolver("127.0.0.1") });
    await expect(g.validateUrl("https://localhost/")).rejects.toMatchObject({
      details: { reason: "loopback" },
    });
  });

  it("rejects metadata service after DNS resolution (DNS rebinding defense)", async () => {
    const g = new SsrfGuard({
      resolver: fixedResolver("169.254.169.254"),
    });
    await expect(g.validateUrl("https://internal.aws/")).rejects.toMatchObject({
      details: { reason: "metadata_service" },
    });
  });

  it("rejects IPv6 link-local", async () => {
    const g = new SsrfGuard({ resolver: fixedResolver("fe80::1", 6) });
    await expect(g.validateUrl("https://example.com/")).rejects.toMatchObject({
      details: { reason: "link_local" },
    });
  });

  it("allowlist bypasses private_range", async () => {
    const g = new SsrfGuard({
      allowedHosts: ["internal.svc"],
      resolver: fixedResolver("10.0.0.5"),
    });
    const r = await g.validateUrl("https://internal.svc/api");
    expect(r.ip).toBe("10.0.0.5");
  });

  it("allowlist does NOT bypass loopback", async () => {
    const g = new SsrfGuard({
      allowedHosts: ["localhost"],
      resolver: fixedResolver("127.0.0.1"),
    });
    await expect(g.validateUrl("https://localhost/")).rejects.toMatchObject({
      details: { reason: "loopback" },
    });
  });

  it("allowlist does NOT bypass metadata service", async () => {
    const g = new SsrfGuard({
      allowedHosts: ["internal.aws"],
      resolver: fixedResolver("169.254.169.254"),
    });
    await expect(g.validateUrl("https://internal.aws/")).rejects.toMatchObject({
      details: { reason: "metadata_service" },
    });
  });

  it("accepts a literal public IPv4 in URL without resolution", async () => {
    let resolverCalled = false;
    const r: Resolver = async () => {
      resolverCalled = true;
      return { address: "0.0.0.0", family: 4 };
    };
    const g = new SsrfGuard({ resolver: r });
    const result = await g.validateUrl("https://1.1.1.1/path");
    expect(result.ip).toBe("1.1.1.1");
    expect(resolverCalled).toBe(false);
  });

  it("rejects literal private IPv4 in URL", async () => {
    const g = new SsrfGuard();
    await expect(g.validateUrl("https://10.0.0.1/")).rejects.toMatchObject({
      details: { reason: "private_range" },
    });
  });

  it("rejects URL with empty host", async () => {
    const g = new SsrfGuard();
    await expect(g.validateUrl("https:///path")).rejects.toBeInstanceOf(
      SecureCoreError,
    );
  });

  it("maps resolver throw to resolver_failure", async () => {
    const g = new SsrfGuard({
      resolver: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    await expect(g.validateUrl("https://nope.invalid/")).rejects.toMatchObject({
      details: { reason: "resolver_failure" },
    });
  });
});

/**
 * SSRF guards — Phase 0.5 Layer 3 task L3.10.
 *
 * Implements v4 §26.1 controls for any URL fetched on behalf of a
 * user:
 *
 *   1. Pinned resolver (DNS lookups go through a single configured
 *      function so a host that round-robins between public and
 *      private addresses cannot slip an internal IP through after a
 *      first benign answer — the resolver is consulted ONCE per URL
 *      and the resolved IP drives both the SSRF check AND the
 *      eventual connection.
 *   2. Rejects loopback (IPv4 127.0.0.0/8, IPv6 ::1).
 *   3. Rejects link-local (IPv4 169.254.0.0/16, IPv6 fe80::/10).
 *   4. Rejects RFC1918 private (10/8, 172.16/12, 192.168/16).
 *   5. Rejects IPv6 equivalents (ULAs fc00::/7, IPv4-mapped private).
 *   6. Re-checks every redirect — `SafeFetcher` re-runs the SSRF
 *      validation on the Location header before following.
 *   7. Blocks cloud metadata service IPs (169.254.169.254 + the
 *      Azure/GCP fdca:: variants).
 *   8. Explicit allowlist for internal endpoints — callers opt-in by
 *      passing `allowedHosts: ["internal.svc"]`; an allowlist hit
 *      bypasses the private-range check (NOT the loopback or
 *      metadata-service refusal — those stay on as defense in depth).
 *
 * The implementation is pure-Node: `node:dns/promises.lookup` is the
 * default resolver. Tests inject a custom `lookup` so deterministic
 * IPs drive every branch without a real DNS round-trip.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Mirrors Node's `dns.LookupAddress` without depending on its export path. */
export interface LookupAddress {
  readonly address: string;
  readonly family: number;
}

import { SecureCoreError } from "../errors/shapes.js";

// ---------------------------------------------------------------------------
// IP classification.
// ---------------------------------------------------------------------------

/**
 * Closed enum of refusal reasons. Audit metadata uses these strings;
 * no free-form text leaks the host or path beyond what the request
 * already exposed.
 */
export type SsrfRefusalReason =
  | "scheme_not_allowed"
  | "host_missing"
  | "loopback"
  | "link_local"
  | "private_range"
  | "ipv6_ula"
  | "metadata_service"
  | "unspecified_address"
  | "broadcast"
  | "multicast"
  | "resolver_failure";

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * IPv4 dotted-quad → 32-bit integer. Returns -1 for malformed input
 * (callers should pre-check with `isIP` so this is defensive).
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) return -1;
  let acc = 0;
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (!Number.isInteger(n) || n < 0 || n > 255) return -1;
    acc = (acc * 256 + n) >>> 0;
  }
  return acc;
}

function inV4Cidr(ip: number, prefixIp: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : ((0xffffffff << (32 - bits)) >>> 0);
  return (ip & mask) === (prefixIp & mask);
}

/** Cloud metadata services. v4 §26.1 #7. */
const METADATA_V4_HOSTS: ReadonlySet<string> = new Set([
  "169.254.169.254", // AWS / GCP / DigitalOcean / OpenStack
  "169.254.170.2", // ECS task metadata
  "100.100.100.200", // Alibaba Cloud
  "100.115.92.193", // Some k8s metadata mirrors
]);

const METADATA_V6_PREFIXES: ReadonlyArray<string> = [
  "fd00:ec2::254", // AWS IMDS v6 (Nitro)
];

function classifyIpv4(ip: string): SsrfRefusalReason | null {
  const n = ipv4ToInt(ip);
  if (n < 0) return "resolver_failure";
  if (METADATA_V4_HOSTS.has(ip)) return "metadata_service";
  // 0.0.0.0/8 unspecified
  if (inV4Cidr(n, ipv4ToInt("0.0.0.0"), 8)) return "unspecified_address";
  // 127.0.0.0/8 loopback
  if (inV4Cidr(n, ipv4ToInt("127.0.0.0"), 8)) return "loopback";
  // 169.254.0.0/16 link-local (already caught metadata above)
  if (inV4Cidr(n, ipv4ToInt("169.254.0.0"), 16)) return "link_local";
  // 10.0.0.0/8 RFC1918
  if (inV4Cidr(n, ipv4ToInt("10.0.0.0"), 8)) return "private_range";
  // 172.16.0.0/12 RFC1918
  if (inV4Cidr(n, ipv4ToInt("172.16.0.0"), 12)) return "private_range";
  // 192.168.0.0/16 RFC1918
  if (inV4Cidr(n, ipv4ToInt("192.168.0.0"), 16)) return "private_range";
  // 100.64.0.0/10 carrier-grade NAT (treat as private)
  if (inV4Cidr(n, ipv4ToInt("100.64.0.0"), 10)) return "private_range";
  // 198.18.0.0/15 benchmarking
  if (inV4Cidr(n, ipv4ToInt("198.18.0.0"), 15)) return "private_range";
  // 224.0.0.0/4 multicast
  if (inV4Cidr(n, ipv4ToInt("224.0.0.0"), 4)) return "multicast";
  // 255.255.255.255 broadcast
  if (n === ipv4ToInt("255.255.255.255")) return "broadcast";
  return null;
}

/**
 * IPv6 lowercase normalized form (without brackets) → refusal reason
 * or null when public.
 *
 * Implemented via prefix-string match on the canonical lowercase form
 * because Node's `URL` already gives us the parsed host, and
 * prefix-checking covers loopback / link-local / ULA without a full
 * 128-bit integer dance.
 */
function classifyIpv6(ip: string): SsrfRefusalReason | null {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::0" || lower === "0:0:0:0:0:0:0:0") {
    return "unspecified_address";
  }
  if (lower === "::1") return "loopback";
  // Link-local fe80::/10
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return "link_local";
  }
  // ULA fc00::/7
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "ipv6_ula";
  // Multicast ff00::/8
  if (lower.startsWith("ff")) return "multicast";
  // IPv4-mapped ::ffff:a.b.c.d → re-classify the IPv4 portion
  const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped !== null) {
    return classifyIpv4(v4mapped[1]);
  }
  // Cloud metadata IPv6 known prefixes
  for (const p of METADATA_V6_PREFIXES) {
    if (lower.startsWith(p.toLowerCase())) return "metadata_service";
  }
  return null;
}

/**
 * Public: returns null when `ip` is an externally-routable address;
 * otherwise returns the closed-enum refusal reason.
 */
export function classifyIp(ip: string): SsrfRefusalReason | null {
  const family = isIP(ip);
  if (family === 4) return classifyIpv4(ip);
  if (family === 6) return classifyIpv6(ip);
  return "resolver_failure";
}

// ---------------------------------------------------------------------------
// URL guard.
// ---------------------------------------------------------------------------

export type Resolver = (host: string) => Promise<LookupAddress>;

const defaultResolver: Resolver = async (host) => {
  return await dnsLookup(host, { verbatim: true });
};

export interface SsrfGuardOptions {
  /** Hosts that bypass private-range rejection. Loopback / metadata stay refused. */
  readonly allowedHosts?: ReadonlyArray<string>;
  /** Custom resolver for tests. Defaults to `dns.lookup`. */
  readonly resolver?: Resolver;
}

export interface SsrfCheckResult {
  /** Resolved IP literal. */
  readonly ip: string;
  /** IP family per node:net `isIP`. */
  readonly family: 4 | 6;
}

export class SsrfGuard {
  readonly #allowedHosts: ReadonlySet<string>;
  readonly #resolver: Resolver;

  public constructor(opts: SsrfGuardOptions = {}) {
    this.#allowedHosts = new Set(
      (opts.allowedHosts ?? []).map((h) => h.toLowerCase()),
    );
    this.#resolver = opts.resolver ?? defaultResolver;
  }

  /**
   * Validate a URL string against v4 §26.1. Throws `INPUT_INVALID`
   * with `{ reason: SsrfRefusalReason }` on rejection. On accept,
   * returns the resolved IP so the caller can use it for the actual
   * connection (to defeat DNS rebinding — connect to the IP directly,
   * passing the original Host header).
   */
  public async validateUrl(rawUrl: string): Promise<SsrfCheckResult> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new SecureCoreError("INPUT_INVALID", "Malformed URL.", {
        reason: "host_missing",
      });
    }
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      throw new SecureCoreError("INPUT_INVALID", "URL scheme not allowed.", {
        reason: "scheme_not_allowed" satisfies SsrfRefusalReason,
        allowed: ["http", "https"],
      });
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (host.length === 0) {
      throw new SecureCoreError("INPUT_INVALID", "URL host missing.", {
        reason: "host_missing" satisfies SsrfRefusalReason,
      });
    }

    const allowed = this.#allowedHosts.has(host.toLowerCase());

    let resolved: LookupAddress;
    if (isIP(host) !== 0) {
      resolved = { address: host, family: isIP(host) };
    } else {
      try {
        resolved = await this.#resolver(host);
      } catch {
        throw new SecureCoreError(
          "INPUT_INVALID",
          "URL host could not be resolved.",
          { reason: "resolver_failure" satisfies SsrfRefusalReason },
        );
      }
    }

    const reason = classifyIp(resolved.address);
    if (reason !== null) {
      // Allowlist short-circuits private_range / ipv6_ula ONLY.
      // Loopback / metadata / link-local / multicast / broadcast /
      // unspecified always refuse — the allowlist is for known
      // internal services on private subnets, not for foot-guns.
      const safeBypass: ReadonlySet<SsrfRefusalReason> = new Set([
        "private_range",
        "ipv6_ula",
      ]);
      if (allowed && safeBypass.has(reason)) {
        return {
          ip: resolved.address,
          family: resolved.family as 4 | 6,
        };
      }
      throw new SecureCoreError("INPUT_INVALID", "URL host not allowed.", {
        reason,
      });
    }

    return { ip: resolved.address, family: resolved.family as 4 | 6 };
  }
}

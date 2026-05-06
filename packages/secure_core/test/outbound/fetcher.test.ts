/**
 * L3.10 — SafeFetcher tests.
 *
 * Mocks the underlying fetch implementation so redirect-chain
 * re-validation is exercised deterministically. Asserts that every
 * hop calls back into the SsrfGuard before the network round-trip.
 */

import { describe, it, expect, vi } from "vitest";

import { SafeFetcher } from "../../src/outbound/fetcher.js";
import {
  SsrfGuard,
  type Resolver,
} from "../../src/outbound/ssrf.js";
import { SecureCoreError } from "../../src/errors/shapes.js";

function fixedResolver(ip: string, family: 4 | 6 = 4): Resolver {
  return async () => ({ address: ip, family });
}

function makeFakeFetch(responses: Response[]): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[i];
    i += 1;
    if (r === undefined) throw new Error("ran out of fake responses");
    return r;
  }) as typeof fetch;
}

describe("SafeFetcher", () => {
  it("validates initial URL before fetch", async () => {
    const guard = new SsrfGuard({ resolver: fixedResolver("8.8.8.8") });
    const validateSpy = vi.spyOn(guard, "validateUrl");
    const fetchImpl = makeFakeFetch([new Response("ok", { status: 200 })]);
    const fetcher = new SafeFetcher({ guard, fetchImpl });
    const r = await fetcher.fetch("https://example.com/");
    expect(r.status).toBe(200);
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });

  it("re-validates the redirect target before following", async () => {
    const guard = new SsrfGuard({
      resolver: async (host) => {
        if (host === "example.com") return { address: "8.8.8.8", family: 4 };
        // First redirect: also public.
        return { address: "1.1.1.1", family: 4 };
      },
    });
    const validateSpy = vi.spyOn(guard, "validateUrl");
    const fetchImpl = makeFakeFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example.com/next" },
      }),
      new Response("ok", { status: 200 }),
    ]);
    const fetcher = new SafeFetcher({ guard, fetchImpl });
    const r = await fetcher.fetch("https://example.com/start");
    expect(r.status).toBe(200);
    expect(validateSpy).toHaveBeenCalledTimes(2);
  });

  it("blocks redirect to a private IP", async () => {
    const guard = new SsrfGuard({
      resolver: async (host) => {
        if (host === "example.com") return { address: "8.8.8.8", family: 4 };
        return { address: "10.0.0.1", family: 4 };
      },
    });
    const fetchImpl = makeFakeFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example.com/" },
      }),
      // Should never reach this:
      new Response("compromised", { status: 200 }),
    ]);
    const fetcher = new SafeFetcher({ guard, fetchImpl });
    await expect(fetcher.fetch("https://example.com/")).rejects.toMatchObject({
      details: { reason: "private_range" },
    });
  });

  it("blocks redirect to metadata service even from a public initial host", async () => {
    const guard = new SsrfGuard({
      resolver: async (host) => {
        if (host === "example.com") return { address: "8.8.8.8", family: 4 };
        return { address: "169.254.169.254", family: 4 };
      },
    });
    const fetchImpl = makeFakeFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://imds.evil/latest/meta-data/" },
      }),
      new Response("token", { status: 200 }),
    ]);
    const fetcher = new SafeFetcher({ guard, fetchImpl });
    await expect(fetcher.fetch("https://example.com/")).rejects.toMatchObject({
      details: { reason: "metadata_service" },
    });
  });

  it("refuses to follow more than maxRedirects hops", async () => {
    const guard = new SsrfGuard({ resolver: fixedResolver("8.8.8.8") });
    const fetchImpl = makeFakeFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://hop1.example.com/" },
      }),
      new Response(null, {
        status: 302,
        headers: { location: "https://hop2.example.com/" },
      }),
      new Response(null, {
        status: 302,
        headers: { location: "https://hop3.example.com/" },
      }),
      new Response("never", { status: 200 }),
    ]);
    const fetcher = new SafeFetcher({ guard, fetchImpl, maxRedirects: 2 });
    await expect(
      fetcher.fetch("https://example.com/"),
    ).rejects.toBeInstanceOf(SecureCoreError);
  });

  it("returns 3xx response when location header is missing", async () => {
    const guard = new SsrfGuard({ resolver: fixedResolver("8.8.8.8") });
    const fetchImpl = makeFakeFetch([new Response(null, { status: 304 })]);
    const fetcher = new SafeFetcher({ guard, fetchImpl });
    const r = await fetcher.fetch("https://example.com/");
    expect(r.status).toBe(304);
  });
});

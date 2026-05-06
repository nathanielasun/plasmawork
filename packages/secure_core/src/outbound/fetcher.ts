/**
 * SSRF-safe fetcher — Phase 0.5 Layer 3 task L3.10.
 *
 * Wraps `globalThis.fetch` with the v4 §26.1 SSRF controls. Per #6,
 * every redirect is re-validated through the `SsrfGuard` before
 * following. We disable native redirect following (`redirect: "manual"`)
 * and walk the chain ourselves, validating each hop.
 *
 * DNS-rebinding defense: each request builds a one-off undici
 * `Agent` whose `connect.lookup` returns the IP the `SsrfGuard`
 * resolved at validate-time, ignoring whatever the resolver returns
 * at connect-time. This closes the validate-then-flap TOCTOU window
 * — a name-server that round-robins between a public answer (passes
 * the guard) and a private answer (the connection target) cannot
 * land on the private host because we don't re-resolve.
 *
 * The original Host header is preserved (undici's connect hook lets
 * us swap the IP without rewriting the URL), so SNI + virtual-host
 * routing still work.
 */

import { Agent } from "undici";
import type { LookupFunction } from "node:net";

import { SsrfGuard, type SsrfCheckResult } from "./ssrf.js";
import { SecureCoreError } from "../errors/shapes.js";
import type { AuditLogger } from "../audit/logger.js";

const DEFAULT_MAX_REDIRECTS = 5;

export interface SafeFetcherOptions {
  readonly guard: SsrfGuard;
  readonly auditLogger?: AuditLogger;
  /** Default 5. Per-request override. */
  readonly maxRedirects?: number;
  /** Native fetch implementation. Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Default 30s; set per-request via the `signal` option. */
  readonly defaultTimeoutMs?: number;
}

/**
 * Headers / body shape — typed as the Node 24 `fetch`'s actual params
 * without pulling in DOM lib. The fetch implementation is responsible
 * for accepting these forms.
 */
export type SafeFetchHeaders =
  | Readonly<Record<string, string>>
  | ReadonlyArray<readonly [string, string]>;
export type SafeFetchBody = string | Uint8Array | Buffer | null;

export interface SafeFetchOptions {
  readonly method?: string;
  readonly headers?: SafeFetchHeaders;
  readonly body?: SafeFetchBody;
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  /** Audit context — populated when the caller is a request handler. */
  readonly requestId?: string;
  readonly actorUserId?: string | null;
}

export class SafeFetcher {
  readonly #guard: SsrfGuard;
  readonly #fetchImpl: typeof fetch;
  readonly #maxRedirects: number;
  readonly #defaultTimeoutMs: number;

  public constructor(opts: SafeFetcherOptions) {
    this.#guard = opts.guard;
    this.#fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.#maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.#defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
    // auditLogger is reserved for future audit emissions on rejected
    // hops; silenced via discard for now to avoid noise on the
    // success path (the SsrfGuard itself doesn't emit audit either).
    void opts.auditLogger;
  }

  public async fetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
    const maxRedirects = opts.maxRedirects ?? this.#maxRedirects;
    const timeoutMs = opts.timeoutMs ?? this.#defaultTimeoutMs;

    let current = url;
    let hops = 0;
    while (true) {
      // (1) Validate every hop — including the initial URL — via the
      // SSRF guard. v4 §26.1 #6: re-check every redirect.
      const validated: SsrfCheckResult = await this.#guard.validateUrl(current);

      // (2) Pin the connection IP to what we just validated. A
      // one-off undici Agent with a custom lookup returns
      // `validated.ip` for any host name; this defeats DNS-rebinding
      // attempts where the second resolution would point at a
      // private IP.
      const pinnedLookup = makePinnedLookup(validated);
      const agent = new Agent({ connect: { lookup: pinnedLookup } });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        // Cast the request init at the boundary so callers don't need
        // DOM lib types in their tsconfig. `dispatcher` is a Node /
        // undici extension to fetch's RequestInit.
        res = await this.#fetchImpl(current, {
          method: opts.method,
          headers: opts.headers as Record<string, string> | undefined,
          body: opts.body as string | Uint8Array | null | undefined,
          redirect: "manual",
          signal: controller.signal,
          dispatcher: agent,
        } as Parameters<typeof fetch>[1] & { dispatcher: Agent });
      } finally {
        clearTimeout(timer);
        // Best-effort agent cleanup — fire and discard.
        void agent.close().catch(() => undefined);
      }

      // Redirect handling. Node's fetch uses statuses 301/302/303/307/308.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (location === null) {
          // Treat dangling redirect as the response.
          return res;
        }
        if (hops >= maxRedirects) {
          throw new SecureCoreError(
            "INPUT_INVALID",
            "Too many redirects.",
            { hops, maxRedirects },
          );
        }
        // Resolve relative redirect against the current URL.
        const next = new URL(location, current).toString();
        current = next;
        hops += 1;
        continue;
      }

      return res;
    }
  }
}

/**
 * Build a `node:dns.lookup`-shaped function that returns the
 * already-validated IP for any host name. Used by undici's
 * `connect.lookup` so the connection target can't drift from the
 * SSRF-checked answer.
 *
 * undici's connect hook accepts the standard Node lookup signature:
 * either a (hostname, options, callback) callback form or a
 * Promise-based form via the synchronous `lookup` field. We return
 * the callback form since that's what undici v6+ expects from the
 * `connect.lookup` slot.
 */
export function makePinnedLookup(validated: SsrfCheckResult): LookupFunction {
  return ((
    _hostname: string,
    options: unknown,
    callback?: (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void,
  ) => {
    // Node's lookup signature has two callback shapes; normalise.
    const cb =
      typeof options === "function"
        ? (options as (
            err: NodeJS.ErrnoException | null,
            address: string,
            family: number,
          ) => void)
        : callback;
    if (cb === undefined) return;
    cb(null, validated.ip, validated.family);
  }) as unknown as LookupFunction;
}

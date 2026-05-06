/**
 * SSRF-safe fetcher — Phase 0.5 Layer 3 task L3.10.
 *
 * Wraps `globalThis.fetch` with the v4 §26.1 SSRF controls. Per #6,
 * every redirect is re-validated through the `SsrfGuard` before
 * following. We disable native redirect following (`redirect: "manual"`)
 * and walk the chain ourselves, validating each hop.
 *
 * The fetcher does NOT swap the connection IP — Node's fetch resolves
 * the host name internally. Defending against DNS rebinding past the
 * single `validateUrl` lookup requires a custom dispatcher; that's a
 * future hardening pass. The current invariant: at the moment we
 * validate, the resolved IP is public. A racy DNS flap between
 * validate-and-connect is the residual TOCTOU window — documented.
 */

import { SsrfGuard } from "./ssrf.js";
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
      await this.#guard.validateUrl(current);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        // Cast the request init at the boundary so callers don't need
        // DOM lib types in their tsconfig.
        res = await this.#fetchImpl(current, {
          method: opts.method,
          headers: opts.headers as Record<string, string> | undefined,
          body: opts.body as string | Uint8Array | null | undefined,
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
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

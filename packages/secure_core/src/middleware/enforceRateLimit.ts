/**
 * `enforceRateLimit` — Phase 0.5 Layer 2 task L2.12.
 *
 * v4 §8 mandates rate limits for: login, signup, password reset, email
 * verification, approval-token submission, membership invitation,
 * artifact export, file import, simulation run creation, worker
 * upload. Auth endpoints additionally require per-IP + per-account
 * limits with exponential backoff. Every rejection emits a
 * `rate_limit.triggered` audit row before the 429 returns.
 *
 * This middleware ships an in-memory sliding-window limiter — fine for
 * single-process MVP and tests, with a clean swap surface (the
 * `RateLimitStore` interface) so Layer 3 can wire a Redis-backed
 * implementation without touching call sites.
 *
 * Limit phases (one slot in §6.2 between `requireRequestId` and
 * `requireAuth`):
 *
 *   - Per-IP rate limits run BEFORE auth so unauthenticated traffic
 *     can be cheaply rejected. Default key extractor: client IP from
 *     X-Forwarded-For (last hop) or `req.ip`.
 *   - Per-account rate limits — fired AFTER auth — are expressed by
 *     calling the limiter inside the handler with `req.auth.userId`
 *     as the key. The middleware itself is single-phase to keep
 *     §6.2 ordering crisp; layered-limit composition is a route
 *     concern.
 *
 * Lockout / exponential backoff: the limiter exposes a `bucket.lockedUntil`
 * timestamp the auth route can advance after consecutive failures.
 * `enforceRateLimit` reads this bucket each request — when locked, the
 * request is rejected with a generic message (v4 §8 "generic error
 * messages") to avoid enumeration.
 *
 * The middleware NEVER tells the caller HOW MANY tries remain.
 */

import type { FastifyRequest } from "fastify";

import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";
import { RateLimitedError } from "../errors/shapes.js";
import type { AuditLogger } from "../audit/logger.js";
import type { ActorType } from "./types.js";

/**
 * Pluggable storage for the limiter. Layer-3 swaps in a Redis-backed
 * implementation; the in-memory default below is fine for tests and
 * single-process dev. The store deliberately operates on a small
 * surface so neither side leaks behavior into the other.
 */
export interface RateLimitStore {
  /**
   * Records a hit at `now` and returns the bucket state. The bucket's
   * `count` covers the trailing `windowMs` window.
   */
  hit(
    key: string,
    nowMs: number,
    windowMs: number,
  ): Promise<RateLimitBucket>;
  /** Marks a key locked-until a future timestamp; for auth backoff. */
  lockUntil(key: string, untilMs: number): Promise<void>;
  /** Reads only — does not consume. Used for the §8 "generic error" path. */
  peek(key: string, nowMs: number, windowMs: number): Promise<RateLimitBucket>;
}

export interface RateLimitBucket {
  /** Number of hits inside the trailing window. */
  readonly count: number;
  /** Epoch-ms; 0 if not locked. */
  readonly lockedUntilMs: number;
}

interface BucketEntry {
  hits: number[]; // unix-ms timestamps
  lockedUntilMs: number;
}

/**
 * In-memory limiter. Garbage-collects expired entries lazily on each
 * `hit` call to avoid an external timer. Bounded growth: each call
 * trims its own bucket; a global LRU is intentionally NOT added — for
 * production scale, swap in the Redis store.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly #buckets = new Map<string, BucketEntry>();

  async hit(
    key: string,
    nowMs: number,
    windowMs: number,
  ): Promise<RateLimitBucket> {
    const cutoff = nowMs - windowMs;
    let entry = this.#buckets.get(key);
    if (!entry) {
      entry = { hits: [], lockedUntilMs: 0 };
      this.#buckets.set(key, entry);
    }
    // Trim expired hits in-place.
    let i = 0;
    while (i < entry.hits.length && entry.hits[i] <= cutoff) {
      i += 1;
    }
    if (i > 0) entry.hits.splice(0, i);
    entry.hits.push(nowMs);
    return { count: entry.hits.length, lockedUntilMs: entry.lockedUntilMs };
  }

  async lockUntil(key: string, untilMs: number): Promise<void> {
    let entry = this.#buckets.get(key);
    if (!entry) {
      entry = { hits: [], lockedUntilMs: 0 };
      this.#buckets.set(key, entry);
    }
    entry.lockedUntilMs = untilMs;
  }

  async peek(
    key: string,
    nowMs: number,
    windowMs: number,
  ): Promise<RateLimitBucket> {
    const cutoff = nowMs - windowMs;
    const entry = this.#buckets.get(key);
    if (!entry) return { count: 0, lockedUntilMs: 0 };
    const live = entry.hits.filter((t) => t > cutoff).length;
    return { count: live, lockedUntilMs: entry.lockedUntilMs };
  }

  /** Test helper: clear all state. Not part of the interface. */
  clear(): void {
    this.#buckets.clear();
  }
}

export type RateLimitKeyExtractor = (req: FastifyRequest) => string;

export interface EnforceRateLimitDeps {
  readonly limit: number;
  readonly windowMs: number;
  /** Keys requests by client IP by default. Override per route to scope per-account / per-path. */
  readonly keyExtractor?: RateLimitKeyExtractor;
  readonly store: RateLimitStore;
  readonly auditLogger: AuditLogger;
  /**
   * Tag inserted into the audit metadata (`endpoint` field) so a
   * single audit-events row carries enough information to find the
   * rate-limit slot that fired.
   */
  readonly endpoint: string;
  /**
   * Optional clock seam for tests. Defaults to `Date.now`.
   */
  readonly now?: () => number;
}

const DEFAULT_KEY_EXTRACTOR: RateLimitKeyExtractor = (req) => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    // Rightmost (closest to server) is the only trustable hop in a
    // chained proxy setup; servers behind a single trusted proxy use
    // the leftmost. We take the leftmost because our deployment plan
    // (ADR-0008) puts a single trusted reverse proxy in front.
    return fwd.split(",")[0]!.trim();
  }
  return req.ip;
};

function pickActorType(req: FastifyRequest): ActorType {
  return req.auth?.actorType ?? "unauthenticated";
}

/**
 * Compose a §6.2-positioned `enforceRateLimit` middleware.
 *
 * Validates `limit > 0` and `windowMs > 0` at factory time so a typo'd
 * config fails on registration, not at first traffic.
 */
export function enforceRateLimit(
  deps: EnforceRateLimitDeps,
): NamedMiddleware {
  if (!Number.isInteger(deps.limit) || deps.limit <= 0) {
    throw new Error(
      `enforceRateLimit: 'limit' must be a positive integer (got ${deps.limit})`,
    );
  }
  if (!Number.isInteger(deps.windowMs) || deps.windowMs <= 0) {
    throw new Error(
      `enforceRateLimit: 'windowMs' must be a positive integer (got ${deps.windowMs})`,
    );
  }
  const keyOf = deps.keyExtractor ?? DEFAULT_KEY_EXTRACTOR;
  const now = deps.now ?? Date.now;

  const handler: MiddlewareHandler = async (req) => {
    const key = keyOf(req);
    const t = now();

    // Lockout check is FIRST — a locked principal does not consume
    // window quota. The lock TTL is set out-of-band by callers (e.g.
    // the login route after N consecutive failures).
    const peek = await deps.store.peek(key, t, deps.windowMs);
    if (peek.lockedUntilMs > t) {
      await deps.auditLogger.write({
        workspaceId: null,
        actorUserId: req.auth?.userId ?? null,
        actorType: pickActorType(req),
        action: "rate_limit.triggered",
        result: "denied",
        requestId: req.requestId,
        metadata: { endpoint: deps.endpoint, denied_reason: "locked" },
      });
      throw new RateLimitedError("Too many requests.", undefined);
    }

    const bucket = await deps.store.hit(key, t, deps.windowMs);
    if (bucket.count > deps.limit) {
      await deps.auditLogger.write({
        workspaceId: null,
        actorUserId: req.auth?.userId ?? null,
        actorType: pickActorType(req),
        action: "rate_limit.triggered",
        result: "denied",
        requestId: req.requestId,
        metadata: {
          endpoint: deps.endpoint,
          denied_reason: "window_exceeded",
          count: bucket.count,
        },
      });
      throw new RateLimitedError("Too many requests.", undefined);
    }
  };

  return { name: "enforceRateLimit", handler };
}

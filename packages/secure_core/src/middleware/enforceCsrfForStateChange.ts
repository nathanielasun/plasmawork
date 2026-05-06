/**
 * `enforceCsrfForStateChange` — Phase 0.5 Layer 2 / L2.2.
 *
 * Browser-channel hardening per v4 §7.2. Two layered checks gate every
 * non-idempotent request:
 *
 *   1. **Origin / Referer allowlist** — applies to every state-changing
 *      method, including the unauthenticated state-change endpoints
 *      enumerated in §7.2 (login, signup, password-reset request +
 *      consume, email-verify consume, magic-link consume, invitation
 *      accept). At least one of `Origin` or `Referer` must parse and
 *      its `.origin` must appear in `allowedOrigins`. Failure emits
 *      `origin.mismatch` and throws `ORIGIN_MISMATCH`.
 *
 *   2. **Synchronizer-token check** — applies only to authenticated
 *      requests (`req.auth` defined). The double-submit pattern: the
 *      `csrf_token` cookie and the `X-CSRF-Token` header must both be
 *      present, non-empty, and equal under constant-time compare.
 *      Failure emits `csrf.failed` and throws `CSRF_FAILED`.
 *
 * Idempotent methods (`GET`, `HEAD`, `OPTIONS`) bypass the entire
 * middleware. State-changing methods follow §7.2 in order.
 *
 * Composition note: this runs after `requireAuth` per §6.2, so an
 * authenticated session has already been established when the
 * synchronizer-token branch fires. Unauthenticated state-change
 * endpoints register the chain WITHOUT `requireAuth`; in that case
 * `req.auth` is undefined and only the Origin check applies, matching
 * §7.2's "at minimum" rule.
 */

import type { FastifyRequest } from "fastify";

import type { MiddlewareHandler, NamedMiddleware } from "./compose.js";
import { SecureCoreError } from "../errors/shapes.js";
import { compareTokenConstantTime, hashToken } from "../crypto/tokens.js";
import type { AuditLogger } from "../audit/logger.js";

export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
]);

export interface EnforceCsrfDeps {
  readonly auditLogger: AuditLogger;
  /** Origin strings as `URL.origin` would format them (e.g. `https://app.plasmawork.test`). */
  readonly allowedOrigins: readonly string[];
}

function parseOriginField(value: string | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function originAllowed(
  req: FastifyRequest,
  allowed: ReadonlySet<string>,
): boolean {
  const headers = req.headers;
  const originHeader = headers.origin;
  const referer = headers.referer ?? headers.referrer;

  const candidates: Array<string | undefined> = [];
  if (typeof originHeader === "string") candidates.push(originHeader);
  if (typeof referer === "string") candidates.push(referer);

  for (const c of candidates) {
    const parsed = parseOriginField(c);
    if (parsed !== null && allowed.has(parsed)) {
      return true;
    }
  }
  return false;
}

function readSingleHeader(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === "string" && first.length > 0) return first;
  }
  return null;
}

export function enforceCsrfForStateChange(
  deps: EnforceCsrfDeps,
): NamedMiddleware {
  const { auditLogger, allowedOrigins } = deps;
  const allowedSet = new Set(allowedOrigins);

  const handler: MiddlewareHandler = async (
    req: FastifyRequest,
  ): Promise<void> => {
    const method = req.method.toUpperCase();
    if (IDEMPOTENT_METHODS.has(method)) return;

    // ---- (1) Origin / Referer allowlist -----------------------------
    if (!originAllowed(req, allowedSet)) {
      await auditLogger.write({
        workspaceId: null,
        actorUserId: req.auth?.userId ?? null,
        actorType: req.auth?.actorType ?? "unauthenticated",
        action: "origin.mismatch",
        result: "denied",
        requestId: req.requestId,
      });
      throw new SecureCoreError(
        "ORIGIN_MISMATCH",
        "Origin or Referer not in allowlist.",
      );
    }

    // ---- (2) Synchronizer token (authenticated only) ----------------
    if (req.auth === undefined) return;

    const cookies = req.cookies as Record<string, string | undefined>;
    const cookieToken = cookies?.[CSRF_COOKIE_NAME];
    const headerToken = readSingleHeader(req.headers[CSRF_HEADER_NAME]);

    const fail = async (): Promise<never> => {
      await auditLogger.write({
        workspaceId: null,
        actorUserId: req.auth?.userId ?? null,
        actorType: req.auth?.actorType ?? "unauthenticated",
        action: "csrf.failed",
        result: "denied",
        requestId: req.requestId,
      });
      throw new SecureCoreError(
        "CSRF_FAILED",
        "CSRF token missing or invalid.",
      );
    };

    if (
      typeof cookieToken !== "string" ||
      cookieToken.length === 0 ||
      headerToken === null
    ) {
      await fail();
    }

    // `compareTokenConstantTime` hashes the presented value and compares
    // against a stored digest. We hash the cookie once so both inputs
    // route through the same constant-time path.
    const cookieDigest = hashToken(cookieToken as string);
    if (!compareTokenConstantTime(headerToken as string, cookieDigest)) {
      await fail();
    }
  };

  return { name: "enforceCsrfForStateChange", handler };
}

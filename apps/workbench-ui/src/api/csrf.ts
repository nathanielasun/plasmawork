/**
 * CSRF helpers — Phase 0.5 / Phase F-rest-final (2026-05-09).
 *
 * The gateway issues a synchronizer ``csrf_token`` cookie on login.
 * State-changing requests must echo that value as ``X-CSRF-Token``
 * (v4 §7.2 double-submit). Both ``secureCoreClient.ts`` (for direct
 * auth/operator calls) and the legacy ``client.ts`` (for the
 * workspace-scoped ``/api/:slug/...`` calls) read the cookie through
 * this module so the logic stays in one place.
 *
 * GET / HEAD / OPTIONS are exempt at the gateway middleware layer
 * (v4 §6 idempotent set), so they do NOT need the header.
 */

/**
 * Cookie name for the CSRF synchronizer token. Must match
 * ``CSRF_COOKIE_NAME`` in ``packages/secure_core/src/routes/login.ts``.
 */
export const CSRF_COOKIE_NAME = "csrf_token";

/**
 * HTTP methods that the gateway treats as state-changing — every
 * one of them flows through ``enforceCsrfForStateChange`` and
 * requires the synchronizer token echoed in ``X-CSRF-Token``.
 */
export const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Read the CSRF cookie value via ``document.cookie``. Returns the
 * empty string when running outside a browser (e.g. SSR / Node tests
 * without ``document`` polyfill). The gateway sets ``csrf_token`` as a
 * non-HttpOnly cookie precisely so the SPA can read it here and echo
 * it (v4 §7.2 double-submit).
 */
export function readCsrfCookieValue(): string {
  if (typeof document === "undefined") return "";
  const raw = document.cookie ?? "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return "";
}

/**
 * Returns true when the given HTTP method is in the gateway's
 * state-changing set and therefore requires a CSRF echo. Method
 * casing is normalized.
 */
export function methodRequiresCsrf(method: string | undefined): boolean {
  return STATE_CHANGING_METHODS.has((method ?? "GET").toUpperCase());
}

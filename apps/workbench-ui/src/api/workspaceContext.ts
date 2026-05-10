/**
 * Workspace context for the API client — Phase 0.5 / Phase F-rest-final
 * (2026-05-09).
 *
 * The gateway routes workspace-scoped API calls through
 * ``/api/:slug/...``. The legacy ``client.ts`` fetch helper needs
 * to know the active slug so it can prefix every URL automatically;
 * the SessionProvider knows the slug from the session response. We
 * bridge the two with a tiny module-level mutable. Setting the slug
 * is the only mutation; the getter is read by ``fetchJson``.
 *
 * Why module-level mutable instead of a hook? ``fetchJson`` is a
 * plain async function called from non-React code (effects, helpers,
 * and old class-based callers). Threading a React context through
 * every call site would be a much larger refactor. The setter is
 * called from a single ``useEffect`` inside SessionProvider so the
 * mutation surface stays narrow and the data flow stays
 * "session → setter → fetchJson reads it" with no other writers.
 *
 * For tests: the ``afterEach`` hook in ``__tests__/setup.ts`` resets
 * the slug to ``null`` between tests so a SessionProvider-using test
 * cannot leak its slug into a later raw-component test that would
 * then mismatch its fetch mocks.
 */

let currentSlug: string | null = null;

/**
 * Set the active workspace slug. ``null`` clears the prefix so calls
 * fall back to the unprefixed ``/api/...`` shape (used by the small
 * set of non-workspace endpoints — currently none in client.ts, but
 * preserved as the safe default for tests and for boot-time calls
 * before a session is established).
 */
export function setCurrentWorkspaceSlug(slug: string | null): void {
  currentSlug = slug && slug.length > 0 ? slug : null;
}

/**
 * Read the active workspace slug. Returns ``null`` when no session
 * is active (boot, tests without a SessionProvider).
 */
export function getCurrentWorkspaceSlug(): string | null {
  return currentSlug;
}

/**
 * Vitest setup — adds @testing-library/jest-dom matchers (toBeInTheDocument
 * etc.) and stubs `fetch` so component tests don't require a running backend.
 */
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

import { setCurrentWorkspaceSlug } from "../api/workspaceContext.js";

// Default fetch stub: tests override per-case as needed.
if (typeof globalThis.fetch !== "function") {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

// LOAD-BEARING — DO NOT REMOVE.
//
// Phase 0.5 / Phase F-rest-final (2026-05-09) introduced module-level
// state in `apps/workbench-ui/src/api/workspaceContext.ts` so the
// active workspace slug can be read by `client.ts:fetchJson` without
// threading a parameter through every component. The state survives
// across Vitest cases by default, which means:
//
//   - Test A mounts <SessionProvider session={...}>; its useEffect
//     writes the slug into workspaceContext.
//   - Test A finishes; React unmounts the provider; the unmount
//     teardown clears the slug.
//   - Test B mounts a raw component (no SessionProvider) and calls
//     fetchJson("/runs"). If A's teardown ran, fetchJson hits
//     "/api/runs" — matching B's mock. If A's teardown DIDN'T run
//     (synchronous test, error path that skipped cleanup, etc.),
//     fetchJson hits "/api/{leaked-slug}/runs" and B's fetch mock
//     misses, producing confusing failures far from the actual bug.
//
// The afterEach below is the belt to React's suspenders. Removing it
// re-opens the leak class. If a future test legitimately needs a
// non-null default slug, set it INSIDE that test's beforeEach + reset
// in its own afterEach; do NOT delete this guard.
afterEach(() => {
  setCurrentWorkspaceSlug(null);
});

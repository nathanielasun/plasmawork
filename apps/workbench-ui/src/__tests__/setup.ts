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

// Reset the workspace context between tests so a SessionProvider-using
// test cannot leak its slug into a later raw-component test, which
// would then fail because the prefixed URL stops matching the test's
// fetch mocks. Phase 0.5 / Phase F-rest-final (2026-05-09).
afterEach(() => {
  setCurrentWorkspaceSlug(null);
});

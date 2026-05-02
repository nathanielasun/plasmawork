/**
 * Vitest setup — adds @testing-library/jest-dom matchers (toBeInTheDocument
 * etc.) and stubs `fetch` so component tests don't require a running backend.
 */
import "@testing-library/jest-dom/vitest";

// Default fetch stub: tests override per-case as needed.
if (typeof globalThis.fetch !== "function") {
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

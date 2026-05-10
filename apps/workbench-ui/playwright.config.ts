/**
 * Playwright config — Layer 5 of the cross-process wiring test strategy.
 *
 * Boots vite-dev (the real config, with the real proxy table) and a
 * stub gateway on the port the proxy targets, then runs a real
 * Chromium against ``http://localhost:5173`` to assert the proxy
 * actually forwards instead of falling back to the SPA HTML.
 *
 * Gated by ``PLASMAWORK_E2E=1`` in the wrapping script. The config
 * itself loads regardless so Playwright commands like
 * ``npx playwright test --list`` work for inspection.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    // Stub gateway on :4000. The vite proxy in vite.config.ts targets
    // this port; the stub returns the responses the real gateway
    // would emit for the prefixes Layer 5 tests cover. Using a stub
    // (rather than booting the real gateway with a real DB and
    // bootstrap admin) keeps Layer 5 surgical: it tests the proxy
    // wiring, not the whole login flow. Real-login E2E is a follow-on.
    {
      command: "node e2e/stubGateway.mjs",
      port: 4000,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});

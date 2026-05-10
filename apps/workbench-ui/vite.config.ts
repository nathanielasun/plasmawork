import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Per AGENTS.md and ADR-0005, the in-app DocsViewer loads pages directly
      // from the canonical docs_site/ source — no duplicated doc strings.
      "@docs": path.resolve(__dirname, "../../docs_site/src/content"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    // Phase 0.5 auth gateway: every UI-facing path goes through the
    // Fastify gateway on :4000. The gateway terminates the cookie
    // session, runs the auth chain, and forwards `/api/:slug/*` to
    // FastAPI on :8000 with the HMAC-signed handoff. Proxying `/api`
    // straight to FastAPI here would bypass the gateway entirely —
    // and `/auth/*`, `/bootstrap`, `/operator/*` only exist on the
    // gateway, so without these entries `/auth/session` 404s against
    // the Vite dev server itself.
    proxy: {
      "/api": "http://localhost:4000",
      "/auth": "http://localhost:4000",
      "/bootstrap": "http://localhost:4000",
      "/operator": "http://localhost:4000",
      "/workspaces": "http://localhost:4000",
      "/approvals": "http://localhost:4000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    // Layer 5 lives in apps/workbench-ui/e2e/ and runs under
    // Playwright (npm run test:e2e). Exclude it from vitest so the
    // .spec.ts files don't accidentally get picked up by the default
    // vitest discovery.
    exclude: ["node_modules", "dist", "build", "e2e/**"],
  },
});

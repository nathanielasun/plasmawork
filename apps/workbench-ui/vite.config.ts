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
    proxy: {
      "/api": "http://localhost:8000",
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
  },
});

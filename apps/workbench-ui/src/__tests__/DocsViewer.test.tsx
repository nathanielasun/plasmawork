/**
 * DocsViewer test — verifies the canonical-source rule from AGENTS.md.
 *
 * As of 2026-05-05 the panel iframes the docs_site dev server (default
 * `http://localhost:3000/`) instead of dynamically importing TSX
 * modules. The earlier `@docs/` dynamic-import pattern was broken
 * (every page 404'd at runtime). The canonical-source rule ("docs
 * come from docs_site/, not the UI bundle") is preserved by the
 * iframe — the docs server itself serves from `docs_site/src/content/`.
 *
 * The contract this test pins:
 *   1. The page list is rendered as clickable buttons.
 *   2. The viewer's source still references `docs_site` (the URL is
 *      written into the canonical-source explanation banner).
 *   3. The iframe URL points at the docs server, NOT at the workbench UI.
 *   4. Doc body text is NOT inlined into the component.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DocsViewer from "../components/DocsViewer";

describe("DocsViewer", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/api/docs/pages")) {
        return new Response(
          JSON.stringify([
            { slug: "overview", title: "Overview", path: "docs_site/src/content/overview.tsx" },
            { slug: "usage", title: "Usage", path: "docs_site/src/content/usage.tsx" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Probe to the docs server returns "ok" so the panel renders the iframe.
      if (u.includes("localhost:3000")) {
        return new Response("", { status: 200 });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
  });

  it("renders navigation buttons for the canonical pages", async () => {
    render(
      <MemoryRouter initialEntries={["/docs"]}>
        <DocsViewer />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("Overview")).toBeInTheDocument();
      expect(screen.getByText("Usage")).toBeInTheDocument();
    });
  });

  it("renders an iframe pointing at the docs server", async () => {
    render(
      <MemoryRouter initialEntries={["/docs/overview"]}>
        <DocsViewer />
      </MemoryRouter>,
    );
    // Wait for the docs-server probe to succeed → iframe gets rendered.
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
    });
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe.src).toMatch(/localhost:3000\/overview/);
  });

  it("source references docs_site and never inlines doc text", () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const src = fs.readFileSync(
      path.resolve(here, "../components/DocsViewer.tsx"),
      "utf-8",
    );
    // Canonical-source rule: the viewer must explicitly explain that
    // docs come from docs_site/, not the UI bundle.
    expect(src).toContain("docs_site");
    // No inlined doc body — sanity check by searching for a phrase
    // that would only exist in the overview page itself.
    expect(src).not.toMatch(/<p>The Scientific Simulation Workbench is/);
  });
});

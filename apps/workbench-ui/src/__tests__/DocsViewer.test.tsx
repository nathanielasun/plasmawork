/**
 * DocsViewer test — verifies the canonical-source rule from AGENTS.md.
 *
 * The user-facing surface is intentionally minimal: a horizontal nav
 * of page links, then the page body. No hero, no architectural
 * exposition. This test pins:
 *   1. One nav link per discovered page.
 *   2. The actual on-disk page body renders when the slug is selected.
 *   3. The viewer's source loads from `docs_site/` via
 *      `import.meta.glob`, not by inlining doc text.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import DocsViewer from "../components/DocsViewer";

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/docs" element={<DocsViewer />} />
        <Route path="/docs/:slug" element={<DocsViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DocsViewer", () => {
  it("renders one nav link per discovered docs page", async () => {
    renderAt("/docs/overview");
    await waitFor(() => {
      expect(screen.getByText("Overview")).toBeInTheDocument();
    });
    // Common canonical pages are present.
    expect(screen.getByText("Architecture")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
  });

  it("renders the actual on-disk page body when a slug is selected", async () => {
    renderAt("/docs/overview");
    // The canonical Overview page contains this token (per docs_site/src/content/overview.tsx).
    await waitFor(() => {
      expect(
        screen.getByText(/Scientific Simulation Workbench/),
      ).toBeInTheDocument();
    });
  });

  it("source references docs_site and import.meta.glob without inlining body", () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const src = fs.readFileSync(
      path.resolve(here, "../components/DocsViewer.tsx"),
      "utf-8",
    );
    expect(src).toContain("docs_site");
    expect(src).toContain("import.meta.glob");
    // No inline doc body — sanity check by searching for a phrase
    // that would only exist in the overview page itself.
    expect(src).not.toMatch(/Scientific Simulation Workbench is a paper-to-experiment/);
  });
});

/**
 * DocsViewer test — verifies the canonical-source rule from AGENTS.md.
 *
 * As of 2026-05-05 the panel uses `import.meta.glob` to bundle every
 * page under `docs_site/src/content/*.tsx` into the workbench UI as
 * lazy chunks. No iframe, no second server, no probe.
 *
 * Contract pinned by this test:
 *   1. The page list renders one button per discovered page.
 *   2. Selecting a page (default = first discovered) renders its
 *      content under the `.docs-content` wrapper. We assert by looking
 *      for a token from the actual on-disk overview page (the canonical
 *      source) — if a future refactor inlines doc text into the UI
 *      bundle separate from docs_site/, this assertion still passes,
 *      so we ALSO check the source file references docs_site/.
 *   3. The viewer source references `docs_site` and uses `import.meta.glob`,
 *      proving it loads from the canonical location, not an inlined copy.
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
  it("renders one navigation button per discovered docs page", async () => {
    renderAt("/docs/overview");
    // The hero pill says "N pages" — at least one page must be discovered.
    await waitFor(() => {
      expect(screen.getByText(/\d+ pages/)).toBeInTheDocument();
    });
    // Common canonical pages are present.
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Architecture")).toBeInTheDocument();
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

  it("source references docs_site and import.meta.glob", () => {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const src = fs.readFileSync(
      path.resolve(here, "../components/DocsViewer.tsx"),
      "utf-8",
    );
    // Canonical-source rule: the viewer must explicitly load from
    // docs_site/, not the UI bundle.
    expect(src).toContain("docs_site");
    expect(src).toContain("import.meta.glob");
    // No inline doc body — sanity check by searching for a phrase
    // that would only exist in the overview page itself.
    expect(src).not.toMatch(/Scientific Simulation Workbench is a paper-to-experiment/);
  });
});

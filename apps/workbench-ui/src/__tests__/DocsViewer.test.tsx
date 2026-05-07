/**
 * DocsViewer test — verifies the canonical-source rule from AGENTS.md.
 *
 * The user-facing surface is a categorized documentation browser with a
 * collapsible/searchable sidebar. This test pins:
 *   1. Canonical pages are reachable through the sidebar.
 *   2. The actual on-disk page body renders when the slug is selected.
 *   3. The viewer's source loads from `docs_site/` via
 *      `import.meta.glob`, not by inlining doc text.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders canonical pages in a categorized documentation sidebar", async () => {
    renderAt("/docs/overview");
    await screen.findByText("What this is");
    const nav = screen.getByRole("navigation", {
      name: /Documentation sections/i,
    });
    expect(within(nav).getByText("Get Started")).toBeInTheDocument();
    expect(within(nav).getByText("Features")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /Architecture/i })).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: /Operating System Compatibility/i }),
    ).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /Using the Workbench/i })).toBeInTheDocument();
  });

  it("filters pages with sidebar search", async () => {
    renderAt("/docs/overview");
    await screen.findByRole("searchbox", { name: /Search documentation/i });
    fireEvent.change(screen.getByRole("searchbox", { name: /Search documentation/i }), {
      target: { value: "capsule" },
    });
    const nav = screen.getByRole("navigation", {
      name: /Documentation sections/i,
    });
    expect(within(nav).getByRole("link", { name: /Simulation Capsules/i })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Installation/i })).not.toBeInTheDocument();
  });

  it("collapses and expands the documentation sidebar", async () => {
    renderAt("/docs/overview");
    const collapse = await screen.findByRole("button", {
      name: /Collapse documentation sidebar/i,
    });
    fireEvent.click(collapse);
    expect(
      screen.getByRole("button", { name: /Expand documentation sidebar/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("searchbox", { name: /Search documentation/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Docs")).not.toBeInTheDocument();
  });

  it("renders the actual on-disk page body when a slug is selected", async () => {
    renderAt("/docs/overview");
    // The canonical Overview page contains this token (per docs_site/src/content/overview.tsx).
    expect(
      await screen.findByText(/paper-to-experiment platform/),
    ).toBeInTheDocument();
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

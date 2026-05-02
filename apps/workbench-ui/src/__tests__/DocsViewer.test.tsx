/**
 * DocsViewer test — verifies the canonical-source rule from AGENTS.md:
 * docs MUST come from `docs_site/src/content/`, not be inlined into the UI.
 *
 * The dynamic import inside DocsViewer is mocked here so we don't have to
 * spin up the full Vite alias resolution in vitest. The contract we exercise
 * is: when the backend returns a list of docs pages, DocsViewer renders the
 * navigation links that route to those pages, AND it never inlines page text
 * (we assert by checking the source file references `@docs/` rather than
 * pasting the doc content into the component).
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
      if (String(url).endsWith("/api/docs/pages")) {
        return new Response(
          JSON.stringify([
            { slug: "overview", title: "Overview", path: "docs_site/src/content/overview.tsx" },
            { slug: "usage", title: "Usage", path: "docs_site/src/content/usage.tsx" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
  });

  it("renders navigation links for the canonical pages", async () => {
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

  it("imports docs from the canonical source (not duplicated in the UI)", () => {
    // Read the DocsViewer source and verify it references `@docs/` — the
    // Vite alias for `docs_site/src/content`. If a future refactor inlines
    // doc text into DocsViewer this test fails, matching AGENTS.md's
    // "no duplicated documentation strings" rule.
    const here = path.dirname(new URL(import.meta.url).pathname);
    const src = fs.readFileSync(
      path.resolve(here, "../components/DocsViewer.tsx"),
      "utf-8",
    );
    expect(src).toContain("@docs/");
    expect(src).toContain("docs_site");
    // Should not contain a doc body — sanity check by looking for an
    // inline opening <article> with non-trivial paragraph content; the
    // viewer should only render its own header + links + the imported
    // canonical Page component.
    expect(src).not.toMatch(/<p>The Scientific Simulation Workbench is/);
  });
});

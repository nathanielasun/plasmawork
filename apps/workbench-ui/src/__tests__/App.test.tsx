/**
 * App shell smoke test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";

describe("App shell", () => {
  beforeEach(() => {
    // Stub fetch so the app's children don't blow up on backend unavailable.
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  it("renders the workbench title", () => {
    render(
      <MemoryRouter initialEntries={["/simulations"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Scientific Simulation Workbench/i)).toBeInTheDocument();
  });

  it("renders all plan-named navigation panels (incl. Phase 3 Tools)", () => {
    render(
      <MemoryRouter initialEntries={["/simulations"]}>
        <App />
      </MemoryRouter>,
    );
    // Some labels (e.g. "Simulations") appear both as a nav link and as the
    // landing page's heading, so we scope the query to the sidebar nav.
    const nav = screen.getByRole("navigation");
    for (const label of [
      "Simulations",
      "Run Controls",
      "Code Viewer",
      "Diagnostics",
      "Plots",
      "Capsules",
      "Tools",
      "Papers",
      "Proposals",
      "Generated Code",
      "Comparisons",
      "Autonomy",
      "Documentation",
    ]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });
});

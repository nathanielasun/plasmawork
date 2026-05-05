/**
 * App shell smoke test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
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
    // Reset persisted sidebar state between tests so the default
    // (expanded) is what each test sees.
    try {
      window.localStorage.removeItem("workbench:sidebar-collapsed");
    } catch {
      // jsdom always supports localStorage; the catch is for safety.
    }
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
      "Examples",
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

  it("collapses the sidebar when the toggle is clicked", () => {
    render(
      <MemoryRouter initialEntries={["/examples"]}>
        <App />
      </MemoryRouter>,
    );
    // Start expanded — full label is visible.
    expect(screen.getByText("Run Controls")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /collapse sidebar/i });
    fireEvent.click(toggle);
    // After collapsing the full label is replaced by the short variant.
    expect(screen.queryByText("Run Controls")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByText("Run")).toBeInTheDocument();
    // Toggle aria-label flips so a screen reader knows what it does next.
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });

  it("persists collapsed state across remounts via localStorage", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/examples"]}>
        <App />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(window.localStorage.getItem("workbench:sidebar-collapsed")).toBe("1");
    unmount();
    render(
      <MemoryRouter initialEntries={["/examples"]}>
        <App />
      </MemoryRouter>,
    );
    // New mount honours the persisted collapsed state — full labels not present.
    expect(screen.queryByText("Run Controls")).not.toBeInTheDocument();
  });
});

/**
 * App shell smoke test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("renders all seven plan-named navigation panels", () => {
    render(
      <MemoryRouter initialEntries={["/simulations"]}>
        <App />
      </MemoryRouter>,
    );
    for (const label of [
      "Simulations",
      "Run Controls",
      "Code Viewer",
      "Diagnostics",
      "Plots",
      "Capsules",
      "Documentation",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

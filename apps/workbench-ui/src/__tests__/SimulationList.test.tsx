/**
 * SimulationList smoke test — renders the example specs table and shows the
 * runs returned by the backend mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SimulationList from "../components/SimulationList";

describe("SimulationList", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      const body = JSON.stringify([
        {
          run_id: "abc123",
          state: "completed",
          elapsed_seconds: 0.012,
          final_simulation_time: 1.0e-7,
          diagnostics_keys: ["A", "B", "time_seconds"],
        },
      ]);
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  it("renders the example ModelSpecs table", () => {
    render(
      <MemoryRouter>
        <SimulationList />
      </MemoryRouter>,
    );
    expect(screen.getByText("simple_rate_equations")).toBeInTheDocument();
    expect(screen.getByText("molecular_dynamics")).toBeInTheDocument();
    expect(screen.getByText("ising_phase_transition")).toBeInTheDocument();
  });

  it("renders runs returned by the backend", async () => {
    render(
      <MemoryRouter>
        <SimulationList />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("abc123")).toBeInTheDocument();
      expect(screen.getByText(/completed/)).toBeInTheDocument();
    });
  });
});

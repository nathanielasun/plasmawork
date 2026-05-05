/**
 * DiagnosticsPanel smoke test.
 *
 * Verifies the panel:
 *  - Surfaces both python_cpu-shaped runs (species_trajectories.A/B) and
 *    tabular script-driven runs (rows.m_per_spin) — i.e. the merged
 *    /api/runs response is rendered correctly.
 *  - Clicking a run reveals its diagnostic keys.
 *  - Clicking a key fetches the series and renders min/max/mean.
 *  - Placeholder runs surface the exploratory pill.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DiagnosticsPanel from "../components/DiagnosticsPanel";

const RUNS = [
  {
    run_id: "ising-feb26c0b",
    state: "completed",
    elapsed_seconds: 0,
    final_simulation_time: 0,
    diagnostics_keys: [
      "rows.T_reduced",
      "rows.m_per_spin",
      "rows.e_per_spin",
    ],
    placeholder_used: false,
    placeholders: [],
  },
  {
    run_id: "abc123",
    state: "completed",
    elapsed_seconds: 0.04,
    final_simulation_time: 1e-7,
    diagnostics_keys: [
      "species_trajectories.A",
      "species_trajectories.B",
      "diagnostics.time_seconds",
    ],
    placeholder_used: true,
    placeholders: ["A_to_B_photoexcitation"],
  },
];

const SERIES = {
  run_id: "ising-feb26c0b",
  name: "rows.m_per_spin",
  times: [0, 1, 2, 3, 4],
  values: [0.987, 0.933, 0.856, 0.413, 0.144],
};

describe("DiagnosticsPanel", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/runs")) {
        return new Response(JSON.stringify(RUNS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/diagnostics/rows.m_per_spin")) {
        return new Response(JSON.stringify(SERIES), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  it("renders both ising-style and python_cpu-style runs", async () => {
    render(
      <MemoryRouter>
        <DiagnosticsPanel />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText("ising-feb26c0b"));
    expect(screen.getByText("abc123")).toBeInTheDocument();
    // Run-count pill says "2 runs".
    expect(screen.getByText(/^2 runs$/)).toBeInTheDocument();
    // Placeholder runs render the exploratory pill.
    expect(screen.getByText(/1 placeholder/)).toBeInTheDocument();
  });

  it("reveals diagnostic keys when a run is selected", async () => {
    render(
      <MemoryRouter>
        <DiagnosticsPanel />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText("ising-feb26c0b"));
    fireEvent.click(screen.getByText("ising-feb26c0b"));
    await waitFor(() => screen.getByText("rows.m_per_spin"));
    expect(screen.getByText("rows.T_reduced")).toBeInTheDocument();
    expect(screen.getByText("rows.e_per_spin")).toBeInTheDocument();
  });

  it("renders the min/max/mean table when a key is selected", async () => {
    render(
      <MemoryRouter>
        <DiagnosticsPanel />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText("ising-feb26c0b"));
    fireEvent.click(screen.getByText("ising-feb26c0b"));
    await waitFor(() => screen.getByText("rows.m_per_spin"));
    fireEvent.click(screen.getByText("rows.m_per_spin"));
    await waitFor(() => screen.getByText(/^samples$/));
    // 5 values total in the SERIES fixture.
    const table = screen.getByText(/^samples$/).closest("table");
    expect(table).not.toBeNull();
    if (table) {
      expect(within(table).getByText("5")).toBeInTheDocument();
    }
  });
});

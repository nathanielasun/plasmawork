/**
 * ExamplesGallery smoke test.
 *
 * Mocks /api/examples + /api/examples/{name}/run, verifies the panel
 * renders one Card per discovered example, surfaces the kind Pill,
 * and shows the run result when the user clicks Run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ExamplesGallery from "../components/examples/ExamplesGallery";

const FIXTURES = [
  {
    name: "simple_rate_equations",
    kind: "modelspec",
    description: "Two-species photoexcitation example.",
    has_model_yaml: true,
    readme_path: "examples/simple_rate_equations/README.md",
    run_path: "examples/simple_rate_equations/run.py",
    model_yaml_path: "examples/simple_rate_equations/model.yaml",
  },
  {
    name: "laser_species",
    kind: "script",
    description: "Lambert-Beer absorption sweep.",
    has_model_yaml: false,
    readme_path: "examples/laser_species/README.md",
    run_path: "examples/laser_species/run.py",
    model_yaml_path: null,
  },
];

describe("ExamplesGallery", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/examples")) {
        return new Response(JSON.stringify(FIXTURES), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/examples/laser_species/run") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            name: "laser_species",
            run_id: "laser_species-deadbeef",
            summary_path: "/abs/temp_runs/laser_species-deadbeef/summary.json",
            capsule_name: null,
            stdout_tail: "[done] summary = ...",
            duration_seconds: 0.42,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  it("renders one card per discovered example with the kind pill", async () => {
    render(
      <MemoryRouter>
        <ExamplesGallery />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("simple_rate_equations")).toBeInTheDocument();
    });
    expect(screen.getByText("laser_species")).toBeInTheDocument();
    expect(screen.getByText(/Lambert-Beer absorption sweep/)).toBeInTheDocument();
    // Both kinds appear as pills.
    expect(screen.getByText("ModelSpec")).toBeInTheDocument();
    expect(screen.getByText("Module script")).toBeInTheDocument();
  });

  it("runs an example on click and surfaces the result", async () => {
    render(
      <MemoryRouter>
        <ExamplesGallery />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("laser_species")).toBeInTheDocument();
    });
    // Find the Run button next to laser_species. There are multiple
    // "Run" buttons; click them all and check the right result lands.
    const runButtons = screen.getAllByRole("button", { name: /^Run$/ });
    // Click the second one (laser_species, the script-kind row).
    fireEvent.click(runButtons[1]);
    await waitFor(() => {
      expect(screen.getAllByText(/laser_species-deadbeef/).length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Run complete/)).toBeInTheDocument();
  });
});

/**
 * RunControls test — clicking Start posts to /api/runs and shows the result.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RunControls from "../components/RunControls";

describe("RunControls", () => {
  let postCalls: { path: string; body: unknown }[] = [];

  beforeEach(() => {
    postCalls = [];
    vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      const path = String(url);
      if (init?.method === "POST") {
        postCalls.push({ path, body: JSON.parse(String(init.body)) });
      }
      return new Response(
        JSON.stringify({
          run_id: "started-001",
          state: "completed",
          elapsed_seconds: 0.05,
          final_simulation_time: 1.0e-7,
          diagnostics_keys: ["A", "B"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
  });

  it("renders the form fields with default values", () => {
    render(<RunControls />);
    expect(screen.getByLabelText("model-yaml-path")).toHaveValue(
      "examples/simple_rate_equations/model.yaml",
    );
    expect(screen.getByLabelText("end-time")).toHaveValue("100 ns");
  });

  it("posts to /api/runs when Start is clicked", async () => {
    render(<RunControls />);
    fireEvent.click(screen.getByRole("button", { name: /start run/i }));
    await waitFor(() => {
      expect(postCalls.length).toBe(1);
      expect(postCalls[0].path).toMatch(/\/api\/runs/);
    });
    expect(await screen.findByText(/started-001/)).toBeInTheDocument();
  });
});

/**
 * Phase 9 / 9D — ComparisonReport panel tests.
 *
 * Carries the post-Phase-2 lesson "UI panels actually render": each
 * test mounts the panel with a mocked backend and asserts a user-
 * observable artifact lands in the DOM (selector, ranking row, best
 * callout).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ComparisonReportPanel from "../components/reports/ComparisonReport";

interface MockResponse {
  body: unknown;
  status?: number;
}

function mockBackend(routes: Record<string, MockResponse>): void {
  // Sort by length descending so the longest pattern matches first
  // (avoids /api/capsules shadowing /api/comparison/foo).
  const sorted = Object.entries(routes).sort(
    ([a], [b]) => b.length - a.length,
  );
  vi.spyOn(global, "fetch").mockImplementation(
    async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      for (const [pattern, resp] of sorted) {
        if (url.endsWith(pattern) || url.includes(pattern)) {
          return new Response(JSON.stringify(resp.body), {
            status: resp.status ?? 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
}

describe("ComparisonReportPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the capsule selector", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
    });
    render(<ComparisonReportPanel />);
    await waitFor(() => {
      expect(screen.getByText("demo.lxp")).toBeInTheDocument();
    });
  });

  it("renders the ranking table after a successful manifest load", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "sweep.lxp", path: "simulation_capsules/sweep.lxp" }],
      },
      "/api/comparison/sweep.lxp": {
        body: {
          title: "Comparison Report",
          sweep_id: "abc123",
          spec_name: "rank_demo",
          metric: "loss",
          lower_is_better: true,
          n_completed: 3,
          n_failed: 0,
          stopped_reason: "completed",
          ranking: [
            {
              rank: 1,
              parameters: { x: 1.0 },
              metrics: { loss: 0.0 },
            },
            {
              rank: 2,
              parameters: { x: 0.5 },
              metrics: { loss: 0.25 },
            },
            {
              rank: 3,
              parameters: { x: -1.0 },
              metrics: { loss: 4.0 },
            },
          ],
        },
      },
    });
    render(<ComparisonReportPanel />);
    await screen.findByText("sweep.lxp");
    fireEvent.change(screen.getByLabelText(/Capsule:/i), {
      target: { value: "sweep.lxp" },
    });
    await waitFor(() => {
      // Ranking table renders the parameter values.
      expect(screen.getByText("rank_demo")).toBeInTheDocument();
      // 1st-rank x = 1.0; the formatted string contains "1.000000".
      expect(screen.getByText("1.000000")).toBeInTheDocument();
    });
  });
});

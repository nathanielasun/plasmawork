/**
 * Phase 4E — PaperReview smoke tests.
 *
 * Verifies the panel actually renders the artifacts the user expects to
 * see (carries the post-Phase-2 lesson "UI panels actually render" — a
 * component file existing isn't enough; the render must surface the
 * data the gate verb promises).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import PaperReview from "../components/papers/PaperReview";

interface MockResponse {
  body: unknown;
  status?: number;
}

function mockBackend(routes: Record<string, MockResponse>): void {
  vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, resp] of Object.entries(routes)) {
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
  });
}

describe("PaperReview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the import controls and capsule list", async () => {
    mockBackend({
      "/api/capsules": {
        body: [
          { name: "demo.lxp", path: "simulation_capsules/demo.lxp" },
        ],
      },
    });
    render(<PaperReview />);
    await waitFor(() => {
      expect(screen.getByText(/Import paper/i)).toBeInTheDocument();
    });
    // Capsule appears in the dropdown.
    expect(screen.getByText("demo.lxp")).toBeInTheDocument();
  });

  it("renders extracted equations and parameters when a capsule is selected", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
      "/api/papers/demo.lxp/extracted": {
        body: {
          equations: [
            {
              id: "eq_001",
              text: "F = ma",
              latex: "F = ma",
              source_line: 5,
              source_file: "paper.md",
              confidence: 0.9,
              edited_by: "",
              notes: "",
            },
          ],
          parameters: [
            {
              name: "kp",
              value: 1.0,
              unit: "1/s",
              missing_units: false,
              source_line: 7,
              source_file: "paper.md",
              confidence: 0.7,
              edited_by: "",
              notes: "",
            },
            {
              name: "x",
              value: 0.5,
              unit: "",
              missing_units: true,
              source_line: 8,
              source_file: "paper.md",
              confidence: 0.4,
              edited_by: "",
              notes: "needs human review",
            },
          ],
          interpretation: {
            paper_summary: "# Summary\nneeds human review",
            assumptions: "# Assumptions\nneeds human review",
            validity_domain: "# Validity\nneeds human review",
            implementation_plan: "# Plan\nneeds human review",
          },
        },
      },
    });
    render(<PaperReview />);
    await screen.findByText("demo.lxp");
    fireEvent.change(screen.getByLabelText(/Capsule:/i), {
      target: { value: "demo.lxp" },
    });
    await waitFor(() => {
      // Equation rendered (use getAllByText since StrictMode may render twice).
      expect(screen.getAllByText("eq_001").length).toBeGreaterThan(0);
      expect(screen.getAllByText("F = ma").length).toBeGreaterThan(0);
      // Parameters rendered.
      expect(screen.getAllByText("kp").length).toBeGreaterThan(0);
      expect(screen.getAllByText("x").length).toBeGreaterThan(0);
      // Missing-units badge surfaces.
      expect(screen.getAllByText("missing units").length).toBeGreaterThan(0);
      // Interpretation section heading renders.
      expect(
        screen.getAllByText(/Interpretation artifacts/i).length,
      ).toBeGreaterThan(0);
    });
  });
});

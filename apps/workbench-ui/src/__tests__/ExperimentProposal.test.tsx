/**
 * Phase 5D — ExperimentProposal smoke tests.
 *
 * Carries the post-Phase-2 lesson "UI panels actually render": each
 * test mounts the panel with a mocked backend and asserts the user-
 * observable artifact (matches table, gap rows, proposal path) shows
 * up in the DOM.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ExperimentProposal from "../components/proposal/ExperimentProposal";

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

describe("ExperimentProposal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the capsule selector and the Generate button", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
    });
    render(<ExperimentProposal />);
    await waitFor(() => {
      expect(screen.getByText(/Generate proposal/i)).toBeInTheDocument();
      expect(screen.getByText("demo.lxp")).toBeInTheDocument();
    });
  });

  it("renders matches and gaps after a successful generate", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
      "/api/proposals": {
        body: {
          capsule: "demo.lxp",
          proposal_path: "simulation_capsules/demo.lxp/experiment_proposal.md",
          modelspec_path: "simulation_capsules/demo.lxp/model/model_spec.yaml",
          matches: {
            matches: [
              {
                name: "rate_equation_0d",
                domain: "species",
                version: "0.1.0",
                score: 0.85,
                sub_scores: {},
                reasons: ["domain matches"],
                directory: "packages/physics_modules/species/rate_equation_0d",
              },
            ],
            unmatched_requirements: [],
          },
          gaps: {
            missing_modules: [],
            missing_data: ["Interaction 'rate1': uses placeholder coefficient"],
            unsupported_regimes: [],
            invalid_solver_choices: [],
            validation_gaps: ["No acceptance criteria"],
          },
        },
      },
    });
    render(<ExperimentProposal />);
    await screen.findByText("demo.lxp");
    fireEvent.change(screen.getByLabelText(/Capsule:/i), {
      target: { value: "demo.lxp" },
    });
    fireEvent.click(screen.getByText("Generate proposal"));
    await waitFor(() => {
      expect(screen.getByText("rate_equation_0d")).toBeInTheDocument();
      expect(
        screen.getByText(/uses placeholder coefficient/),
      ).toBeInTheDocument();
      expect(screen.getByText("No acceptance criteria")).toBeInTheDocument();
    });
  });
});

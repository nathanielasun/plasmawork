/**
 * Phase 3D — ToolList smoke tests.
 *
 * Mounts ToolList against a mocked /api/tools backend and asserts the
 * registered tool actually renders. Carries the post-Phase-2 lesson
 * "UI panels actually render" — the component file existing isn't
 * enough; the integration must produce text the user can see.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ToolList from "../components/tools/ToolList";

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

describe("ToolList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders registered tools grouped by type", async () => {
    mockBackend({
      "/api/tools": {
        body: [
          {
            name: "absorption_spectrum_diagnostic",
            type: "diagnostic",
            version: "0.1.0",
            status: "candidate",
            directory: "packages/internal_tools/registry/absorption_spectrum_diagnostic",
          },
        ],
      },
    });
    render(<ToolList />);
    await waitFor(() => {
      expect(screen.getByText("absorption_spectrum_diagnostic")).toBeInTheDocument();
      expect(screen.getByText("diagnostic")).toBeInTheDocument();
      expect(screen.getByText("candidate")).toBeInTheDocument();
    });
  });

  it("opens detail panel when a tool is clicked", async () => {
    mockBackend({
      "/api/tools/absorption_spectrum_diagnostic/docs": {
        body: { name: "absorption_spectrum_diagnostic", readme: "# Hi", tool_yaml: "name: x" },
      },
      "/api/tools/absorption_spectrum_diagnostic": {
        body: {
          name: "absorption_spectrum_diagnostic",
          directory: "packages/internal_tools/registry/absorption_spectrum_diagnostic",
          metadata: {
            name: "absorption_spectrum_diagnostic",
            version: "0.1.0",
            type: "diagnostic",
            description: "Find absorption peaks.",
            author: "local",
            status: "candidate",
            entrypoint: "src/tool.py:AbsorptionSpectrumDiagnostic",
            inputs: [
              { name: "frequency", type: "array", units: "Hz", description: "" },
            ],
            outputs: [
              { name: "peaks", type: "table", description: "" },
            ],
            compatible_domains: ["spectroscopy"],
            requires: { python: ["numpy"], system: [] },
            validation: { tests: [], reference_cases: [] },
          },
        },
      },
      "/api/tools": {
        body: [
          {
            name: "absorption_spectrum_diagnostic",
            type: "diagnostic",
            version: "0.1.0",
            status: "candidate",
            directory: "packages/internal_tools/registry/absorption_spectrum_diagnostic",
          },
        ],
      },
    });
    render(<ToolList />);
    await screen.findByText("absorption_spectrum_diagnostic");
    fireEvent.click(
      screen.getByRole("button", {
        name: /absorption_spectrum_diagnostic/i,
      }),
    );
    await waitFor(() => {
      expect(screen.getAllByText("Find absorption peaks.").length).toBeGreaterThan(0);
      // Ports rendered.
      expect(screen.getAllByText("frequency").length).toBeGreaterThan(0);
      expect(screen.getAllByText("peaks").length).toBeGreaterThan(0);
    });
  });

  it("shows placeholder when registry is empty", async () => {
    mockBackend({
      "/api/tools": { body: [] },
    });
    render(<ToolList />);
    await waitFor(() => {
      expect(
        screen.getByText(/No tools registered yet/i),
      ).toBeInTheDocument();
    });
  });
});

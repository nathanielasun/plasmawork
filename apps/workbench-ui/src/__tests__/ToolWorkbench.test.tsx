import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ToolWorkbench from "../components/tools/ToolWorkbench";

interface MockResponse {
  body: unknown;
  status?: number;
}

function mockBackend(routes: Record<string, MockResponse>): void {
  vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, response] of Object.entries(routes)) {
      if (url.endsWith(pattern)) {
        return new Response(JSON.stringify(response.body), {
          status: response.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ detail: `No mock for ${url}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  });
}

const schema = {
  name: "sample_table_tool",
  version: "1.0.0",
  type: "diagnostic",
  status: "candidate",
  description: "Runs a schema-bound table tool.",
  inputs: [
    {
      name: "threshold",
      kind: "scalar",
      type: "scalar",
      units: "dimensionless",
      description: "Detection threshold.",
      required: true,
    },
    {
      name: "label",
      kind: "string",
      type: "string",
      description: "Run label.",
      required: true,
    },
    {
      name: "enabled",
      kind: "bool",
      type: "bool",
      description: "Enable processing.",
      required: false,
    },
    {
      name: "samples",
      kind: "table",
      type: "table",
      description: "Inline samples.",
      required: true,
    },
  ],
  outputs: [
    { name: "peak_count", kind: "scalar", type: "scalar", units: "count" },
    { name: "peaks", kind: "table", type: "table" },
    { name: "transform_graph", kind: "diagram", type: "diagram" },
  ],
  permissions: { filesystem: "none", network: "none", high_risk_actions: [] },
};

describe("ToolWorkbench", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders schema-bound inputs, previews, executes, and displays table plus diagram outputs", async () => {
    mockBackend({
      "/api/tools/sample_table_tool/schema": { body: schema },
      "/api/tools/sample_table_tool/preview": {
        body: {
          name: "sample_table_tool",
          ok: true,
          validation: [{ severity: "info", message: "Preview accepted." }],
          planned_artifacts: [
            {
              artifact_id: "planned:sample_table_tool:peaks",
              name: "peaks",
              kind: "table",
              mime_type: "application/json",
            },
          ],
        },
      },
      "/api/tools/sample_table_tool/runs": {
        body: {
          name: "sample_table_tool",
          run_id: "run-1",
          status: "completed",
          outputs: [
            { name: "peak_count", kind: "scalar", value: 2, units: "count" },
            {
              name: "peaks",
              kind: "table",
              value: [
                { frequency: 10, intensity: 0.8 },
                { frequency: 20, intensity: 0.9 },
              ],
            },
            {
              name: "transform_graph",
              kind: "diagram",
              value: {
                title: "Transform graph",
                nodes: [
                  { id: "input", label: "Input" },
                  { id: "output", label: "Output" },
                ],
                edges: [{ source: "input", target: "output", label: "normalize" }],
              },
            },
          ],
          artifacts: [
            {
              artifact_id: "artifact-peaks",
              name: "peaks.json",
              kind: "table",
              mime_type: "application/json",
              size_bytes: 128,
            },
          ],
          validation: [{ severity: "info", message: "Run completed." }],
          logs: ["run started", "run completed"],
        },
      },
      "/api/tools/sample_table_tool/runs/run-1/artifacts": {
        body: [
          {
            artifact_id: "artifact-graph",
            name: "graph.json",
            kind: "diagram",
            mime_type: "application/json",
            size_bytes: 256,
          },
        ],
      },
    });

    render(<ToolWorkbench toolName="sample_table_tool" />);

    await screen.findByText("Runs a schema-bound table tool.");
    fireEvent.change(screen.getByLabelText("threshold"), { target: { value: "0.7" } });
    fireEvent.change(screen.getByLabelText("label"), { target: { value: "demo" } });
    fireEvent.click(screen.getByLabelText("enabled"));
    fireEvent.change(screen.getByLabelText("samples"), {
      target: { value: "frequency,intensity\n10,0.8\n20,0.9" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("Preview accepted.");
    expect(screen.getByText(/peaks · table/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Execute tool" }));
    await screen.findByText("run completed");
    await waitFor(() => {
      expect(screen.getByText("peak_count")).toBeInTheDocument();
      expect(screen.getByText("frequency")).toBeInTheDocument();
      expect(screen.getAllByText("transform_graph").length).toBeGreaterThan(0);
      expect(screen.getByText("artifact-graph")).toBeInTheDocument();
    });
  });
});

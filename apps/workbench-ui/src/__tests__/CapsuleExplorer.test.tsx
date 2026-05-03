/**
 * CapsuleExplorer smoke tests — Phase 2D.
 *
 * Covers: list rendering, capsule selection enabling the tab strip, and
 * tab switching (Manifest → Validation) firing the right backend calls.
 * Backend responses are mocked via `fetch` so the test never touches the
 * filesystem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CapsuleExplorer from "../components/CapsuleExplorer";

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

describe("CapsuleExplorer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the list of capsules from the backend", async () => {
    mockBackend({
      "/api/capsules": {
        body: [
          { name: "demo.lxp", path: "simulation_capsules/demo.lxp" },
          { name: "other.lxp", path: "simulation_capsules/other.lxp" },
        ],
      },
      "/api/temp_runs": { body: [] },
    });
    render(
      <MemoryRouter>
        <CapsuleExplorer />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("demo.lxp")).toBeInTheDocument();
      expect(screen.getByText("other.lxp")).toBeInTheDocument();
    });
  });

  it("opens the manifest tab when a capsule is selected", async () => {
    mockBackend({
      "/api/capsules/demo.lxp/validate": { body: {} },
      "/api/capsules/demo.lxp": {
        body: {
          name: "demo.lxp",
          path: "simulation_capsules/demo.lxp",
          manifest: {
            capsule: { name: "demo", format_version: "0.1" },
            paper: {},
            model: { model_spec_path: "model/model_spec.yaml" },
            runtime: { default_seed: 0, placeholders: [] },
            provenance: {},
          },
          manifest_error: null,
          subtrees: [{ name: "model", kind: "dir", entries: 1 }],
        },
      },
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
      "/api/temp_runs": { body: [] },
    });
    render(
      <MemoryRouter>
        <CapsuleExplorer />
      </MemoryRouter>,
    );
    await screen.findByText("demo.lxp");
    fireEvent.click(screen.getByText("demo.lxp"));
    // Manifest tab is selected by default — its section header includes the
    // file name.
    await waitFor(() => {
      expect(screen.getByText("manifest.toml")).toBeInTheDocument();
    });
  });

  it("switches to the validation tab on click", async () => {
    mockBackend({
      "/api/capsules/demo.lxp/validate": {
        body: {
          name: "demo.lxp",
          ok: false,
          violations: [
            {
              severity: "error",
              code: "missing_required_file",
              message: "Required capsule file is missing: README.md",
              path: "README.md",
            },
          ],
          errors: ["missing_required_file"],
          warnings: [],
        },
      },
      "/api/capsules/demo.lxp": {
        body: {
          name: "demo.lxp",
          path: "simulation_capsules/demo.lxp",
          manifest: null,
          manifest_error: null,
          subtrees: [],
        },
      },
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
      "/api/temp_runs": { body: [] },
    });
    render(
      <MemoryRouter>
        <CapsuleExplorer />
      </MemoryRouter>,
    );
    await screen.findByText("demo.lxp");
    fireEvent.click(screen.getByText("demo.lxp"));
    fireEvent.click(screen.getByText("Validation"));
    await waitFor(() => {
      expect(screen.getByText("FAILED")).toBeInTheDocument();
      expect(screen.getByText("missing_required_file")).toBeInTheDocument();
    });
  });
});

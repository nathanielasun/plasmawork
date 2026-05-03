/**
 * Phase 6D — GeneratedCodeView smoke tests.
 *
 * Carries the Phase-2 audit lesson "UI panels actually render": every
 * test mounts the panel with a mocked backend and asserts a user-
 * observable artifact lands in the DOM (file row, regeneration result,
 * validation path).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import GeneratedCodeView from "../components/codegen/GeneratedCodeView";

interface MockResponse {
  body: unknown;
  status?: number;
}

function mockBackend(routes: Record<string, MockResponse>): void {
  // Match the most specific route (longest pattern) first so /api/capsules
  // doesn't shadow /api/capsules/demo.lxp/codegen.
  const sorted = Object.entries(routes).sort(
    ([a], [b]) => b.length - a.length,
  );
  vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
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
  });
}

describe("GeneratedCodeView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the capsule selector and action buttons", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
    });
    render(<GeneratedCodeView />);
    await waitFor(() => {
      expect(screen.getByText("Regenerate")).toBeInTheDocument();
      expect(screen.getByText("View diff")).toBeInTheDocument();
      expect(screen.getByText("Run validation")).toBeInTheDocument();
    });
  });

  it("lists files in the generated tree separately from user_edits/", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
      "/api/capsules/demo.lxp/codegen": {
        body: {
          capsule: "demo.lxp",
          generated_files: [
            { path: "src/generated/experiment.py", size_bytes: 1024 },
          ],
          user_edits_files: [
            { path: "src/user_edits/tweak.py", size_bytes: 64 },
          ],
          manifest: null,
        },
      },
    });
    render(<GeneratedCodeView />);
    await screen.findByText("demo.lxp");
    fireEvent.change(screen.getByLabelText(/Capsule:/i), {
      target: { value: "demo.lxp" },
    });
    await waitFor(() => {
      expect(
        screen.getByText("src/generated/experiment.py"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("src/user_edits/tweak.py"),
      ).toBeInTheDocument();
    });
  });

  it("saves a user_edits/ file via the editor and reports the saved path", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
      "/api/capsules/demo.lxp/codegen": {
        body: {
          capsule: "demo.lxp",
          generated_files: [],
          user_edits_files: [],
          manifest: null,
        },
      },
      "/api/capsules/demo.lxp/user_edits/run_overrides.py": {
        body: {
          capsule: "demo.lxp",
          path: "src/user_edits/run_overrides.py",
          size_bytes: 32,
        },
      },
    });
    render(<GeneratedCodeView />);
    await screen.findByText("demo.lxp");
    fireEvent.change(screen.getByLabelText(/Capsule:/i), {
      target: { value: "demo.lxp" },
    });
    fireEvent.click(screen.getByText("Save user edit"));
    await waitFor(() => {
      expect(
        screen.getByText(/src\/user_edits\/run_overrides\.py/),
      ).toBeInTheDocument();
    });
  });

  it("renders the diff lists (added/removed/changed) when the diff endpoint reports them", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
      "/api/capsules/demo.lxp/codegen": {
        body: {
          capsule: "demo.lxp",
          generated_files: [],
          user_edits_files: [],
          manifest: null,
        },
      },
      "/api/capsules/demo.lxp/codegen/diff": {
        body: {
          capsule: "demo.lxp",
          previous: {
            generated_at: "2026-05-03T00:00:00.000000+00:00",
            workbench_version: "0.0.0",
            spec_name: "demo",
            spec_domain: "species",
            files: [
              { path: "src/generated/experiment.py", sha256: "a".repeat(64) },
              { path: "src/generated/old.py", sha256: "c".repeat(64) },
            ],
          },
          current_preview: [
            { path: "src/generated/experiment.py", sha256: "b".repeat(64) },
            { path: "src/generated/new.py", sha256: "d".repeat(64) },
          ],
          added: ["src/generated/new.py"],
          removed: ["src/generated/old.py"],
          changed: ["src/generated/experiment.py"],
          unchanged: [],
        },
      },
    });
    render(<GeneratedCodeView />);
    await screen.findByText("demo.lxp");
    fireEvent.change(screen.getByLabelText(/Capsule:/i), {
      target: { value: "demo.lxp" },
    });
    fireEvent.click(screen.getByText("View diff"));
    await waitFor(() => {
      // Each bucket renders with its file rows. This guards against
      // the "diff endpoint that doesn't diff" pattern leaking into
      // the UI: the panel must actually show added/removed/changed,
      // not a generic count.
      expect(screen.getByText("src/generated/new.py")).toBeInTheDocument();
      expect(screen.getByText("src/generated/old.py")).toBeInTheDocument();
      expect(
        screen.getByText("src/generated/experiment.py"),
      ).toBeInTheDocument();
    });
  });

  it("reports the validation summary path after running validation", async () => {
    mockBackend({
      "/api/capsules": {
        body: [{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }],
      },
      "/api/capsules/demo.lxp/codegen": {
        body: {
          capsule: "demo.lxp",
          generated_files: [],
          user_edits_files: [],
          manifest: null,
        },
      },
      "/api/capsules/demo.lxp/validate-run": {
        body: {
          capsule: "demo.lxp",
          summary_path:
            "simulation_capsules/demo.lxp/validation/validation_summary.md",
        },
      },
    });
    render(<GeneratedCodeView />);
    await screen.findByText("demo.lxp");
    fireEvent.change(screen.getByLabelText(/Capsule:/i), {
      target: { value: "demo.lxp" },
    });
    fireEvent.click(screen.getByText("Run validation"));
    await waitFor(() => {
      expect(
        screen.getByText(/validation\/validation_summary\.md/),
      ).toBeInTheDocument();
    });
  });
});

/**
 * CodeViewer test — verifies the viewer uses the capsule file APIs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CodeViewer from "../components/CodeViewer";

describe("CodeViewer", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith("/api/capsules")) {
        return new Response(
          JSON.stringify([{ name: "demo.lxp", path: "simulation_capsules/demo.lxp" }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.includes("/api/capsules/demo.lxp/tree")) {
        return new Response(
          JSON.stringify({
            name: "demo.lxp",
            subtree: "src",
            files: [{ path: "src/generated/run.py", size_bytes: 21 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.includes("/api/capsules/demo.lxp/files/src/generated/run.py")) {
        return new Response(
          JSON.stringify({
            name: "run.py",
            path: "src/generated/run.py",
            content: "print('capsule run')",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
  });

  it("loads capsule source from the backend file contract", async () => {
    render(<CodeViewer />);

    expect(await screen.findByLabelText("code-viewer-capsule")).toHaveValue(
      "demo.lxp",
    );
    await waitFor(() => {
      expect(screen.getByLabelText("code-viewer-path")).toHaveValue(
        "src/generated/run.py",
      );
    });
    expect(await screen.findByText("print('capsule run')")).toBeInTheDocument();
  });
});

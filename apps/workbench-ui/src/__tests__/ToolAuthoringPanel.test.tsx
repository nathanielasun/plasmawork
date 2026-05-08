import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ToolAuthoringPanel from "../components/tools/ToolAuthoringPanel";
import type {
  ToolAuthoringCheckResult,
  ToolAuthoringDraft,
  ToolAuthoringTemplate,
} from "../api/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ToolAuthoringPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a draft, runs the checker, and registers through backend endpoints", async () => {
    const template: ToolAuthoringTemplate = {
      template_id: "diagnostic",
      title: "Diagnostic Template",
      description: "Diagnostic starter package.",
      type: "diagnostic",
      editable_files: ["tool.yaml", "README.md", "src/tool.py", "tests/test_template.py"],
      required_files: ["tool.yaml", "README.md", "src/tool.py"],
    };
    const check: ToolAuthoringCheckResult = {
      passed: true,
      returncode: 0,
      stdout: "Tool package check passed",
      stderr: "",
      issues: [],
      checked_at: "2026-05-07T00:00:00Z",
      content_hash: "hash-1",
    };
    let draft: ToolAuthoringDraft = {
      draft_id: "draft-123456abcdef",
      workspace_id: "local",
      tool_name: "new_diag_tool",
      template_id: "diagnostic",
      status: "draft",
      draft_root: "local_cache/workspaces/local/tool_drafts/draft-123456abcdef",
      content_hash: "hash-1",
      manifest_ok: true,
      manifest_errors: [],
      files: [
        { path: "tool.yaml", size_bytes: 80, editable: true },
        { path: "README.md", size_bytes: 20, editable: true },
        { path: "src/tool.py", size_bytes: 200, editable: true },
        { path: "tests/test_template.py", size_bytes: 40, editable: true },
      ],
      last_check: null,
      registered_tool: null,
      created_at: "2026-05-07T00:00:00Z",
      updated_at: "2026-05-07T00:00:00Z",
    };
    const files: Record<string, string> = {
      "tool.yaml": "name: new_diag_tool\nstatus: draft\n",
      "README.md": "# New diagnostic\n",
      "src/tool.py": "class DiagnosticTemplate: pass\n",
      "tests/test_template.py": "def test_template():\n    assert True\n",
    };
    const onRegistered = vi.fn();

    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/tool-authoring/templates")) {
        return jsonResponse([template]);
      }
      if (url.endsWith("/api/tool-authoring/drafts") && !init) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/tool-authoring/drafts") && init?.method === "POST") {
        return jsonResponse(draft);
      }
      if (url.endsWith(`/api/tool-authoring/drafts/${draft.draft_id}`)) {
        return jsonResponse(draft);
      }
      if (url.endsWith(`/api/tool-authoring/drafts/${draft.draft_id}/files/tool.yaml`)) {
        return jsonResponse({
          draft_id: draft.draft_id,
          path: "tool.yaml",
          content: files["tool.yaml"],
          editable: true,
          size_bytes: files["tool.yaml"].length,
        });
      }
      if (url.endsWith(`/api/tool-authoring/drafts/${draft.draft_id}/check`)) {
        draft = { ...draft, status: "checked", last_check: check };
        return jsonResponse(check);
      }
      if (url.endsWith(`/api/tool-authoring/drafts/${draft.draft_id}/register`)) {
        draft = {
          ...draft,
          status: "registered",
          registered_tool: {
            name: "new_diag_tool",
            directory: "local_cache/imported_tools/new_diag_tool",
            registered_at: "2026-05-07T00:01:00Z",
          },
        };
        return jsonResponse({
          draft_id: draft.draft_id,
          name: "new_diag_tool",
          directory: "local_cache/imported_tools/new_diag_tool",
        });
      }
      return jsonResponse({ detail: `unmocked ${url}` }, 404);
    });

    render(<ToolAuthoringPanel onRegistered={onRegistered} />);

    await screen.findByText("Diagnostic Template");
    fireEvent.change(screen.getByLabelText("New tool name"), {
      target: { value: "new_diag_tool" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await screen.findByText(/Draft created for new_diag_tool/i);
    expect(screen.getByDisplayValue(/name: new_diag_tool/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run package check" }));
    await screen.findByText("Package check passed.");

    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => {
      expect(onRegistered).toHaveBeenCalledWith("new_diag_tool");
    });
  });
});

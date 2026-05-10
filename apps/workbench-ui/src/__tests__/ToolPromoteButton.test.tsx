/**
 * ToolPromoteButton tests — Phase α.4 / α.5 (2026-05-10).
 *
 * Pins:
 *   1. Without ``tool:request_promotion``, the button does NOT render
 *      at all.
 *   2. With the capability + at least one promotable target, the
 *      button renders and the inline form opens on click.
 *   3. The target picker excludes the active workspace and ``_platform``.
 *   4. Submit calls ``requestToolPromotion`` with the chosen slug +
 *      justification; success shows a status message.
 *   5. With the capability but no other memberships, the button is
 *      disabled with a hint title.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SessionProvider } from "../components/auth/SessionContext";
import { ToolPromoteButton } from "../components/tools/ToolPromoteButton";
import type { CurrentSessionResponse } from "../api/secureCoreClient";

function buildSession(
  memberships: Array<{
    name: string;
    capabilities?: readonly string[];
  }>,
): CurrentSessionResponse {
  return {
    user_id: "11111111-1111-4111-8111-111111111111",
    session_id: "22222222-2222-4222-8222-222222222222",
    actor_type: "human",
    assurance_level: "aal2",
    memberships: memberships.map((m, idx) => ({
      workspace_id: `00000000-0000-4000-8000-${String(idx).padStart(12, "0")}`,
      workspace_name: m.name,
      role_id: "5b807f69-df63-5054-a96a-490c9668a567",
      role_name: "WorkspaceAdmin",
      capabilities: (m.capabilities ?? []) as readonly never[],
    })),
  };
}

describe("ToolPromoteButton", () => {
  it("does not render when capability is absent", () => {
    const api = { requestToolPromotion: vi.fn() };
    render(
      <SessionProvider
        session={buildSession([
          { name: "shared-public-experiments", capabilities: [] },
        ])}
      >
        <ToolPromoteButton toolName="my_tool" api={api} />
      </SessionProvider>,
    );
    expect(screen.queryByRole("button", { name: /promote/i })).toBeNull();
    expect(api.requestToolPromotion).not.toHaveBeenCalled();
  });

  it("renders the button + opens the form when capability is present", () => {
    const api = { requestToolPromotion: vi.fn() };
    render(
      <SessionProvider
        session={buildSession([
          {
            name: "shared-public-experiments",
            capabilities: ["tool:request_promotion"],
          },
          { name: "shared-internal-tools" },
          { name: "_platform" },
        ])}
      >
        <ToolPromoteButton toolName="my_tool" api={api} />
      </SessionProvider>,
    );
    const btn = screen.getByRole("button", { name: /^promote$/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    // Form is open; a target picker appears.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    // Active workspace + _platform excluded; only shared-internal-tools remains.
    expect(options).toContain("shared-internal-tools");
    expect(options).not.toContain("shared-public-experiments");
    expect(options).not.toContain("_platform");
  });

  it("submits the form and reports success", async () => {
    const api = {
      requestToolPromotion: vi.fn(async () => ({
        request_id: "11111111-1111-4111-8111-111111111111",
        tool_name: "my_tool",
        from_workspace_slug: "shared-public-experiments",
        to_workspace_slug: "shared-internal-tools",
        requested_by: "user_alice",
        requested_at: "2026-05-10T08:00:00Z",
        justification: "vetted",
        status: "pending" as const,
      })),
    };
    render(
      <SessionProvider
        session={buildSession([
          {
            name: "shared-public-experiments",
            capabilities: ["tool:request_promotion"],
          },
          { name: "shared-internal-tools" },
        ])}
      >
        <ToolPromoteButton toolName="my_tool" api={api} />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^promote$/i }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "shared-internal-tools" },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "vetted" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /request promotion/i }),
    );
    await waitFor(() =>
      expect(api.requestToolPromotion).toHaveBeenCalledWith("my_tool", {
        to_workspace_slug: "shared-internal-tools",
        justification: "vetted",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /promotion request submitted/i,
      ),
    );
  });

  it("disables the button when there are no valid target workspaces", () => {
    const api = { requestToolPromotion: vi.fn() };
    render(
      <SessionProvider
        session={buildSession([
          {
            name: "shared-public-experiments",
            capabilities: ["tool:request_promotion"],
          },
          { name: "_platform" },
        ])}
      >
        <ToolPromoteButton toolName="my_tool" api={api} />
      </SessionProvider>,
    );
    const btn = screen.getByRole("button", {
      name: /^promote$/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/no other workspaces/i);
  });
});

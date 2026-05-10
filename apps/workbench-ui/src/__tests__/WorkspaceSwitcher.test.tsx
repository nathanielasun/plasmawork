/**
 * WorkspaceSwitcher tests — Phase 0.5 / Phase F-rest (2026-05-09).
 *
 * Pins the three render shapes:
 *   1. Multiple memberships → dropdown with each non-_platform name.
 *   2. Single membership → label, no dropdown.
 *   3. Zero memberships → "ask administrator" message.
 *
 * Plus the activeWorkspaceSlug update path.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SessionProvider } from "../components/auth/SessionContext";
import { WorkspaceSwitcher } from "../components/auth/WorkspaceSwitcher";
import type { CurrentSessionResponse } from "../api/secureCoreClient";

function buildSession(
  workspaces: Array<{ name: string; isPlatform?: boolean }>,
): CurrentSessionResponse {
  return {
    user_id: "11111111-1111-4111-8111-111111111111",
    session_id: "22222222-2222-4222-8222-222222222222",
    actor_type: "human",
    assurance_level: "aal2",
    memberships: workspaces.map((w, idx) => ({
      workspace_id: `00000000-0000-4000-8000-${String(idx).padStart(12, "0")}`,
      workspace_name: w.name,
      role_id: "5b807f69-df63-5054-a96a-490c9668a567",
      role_name: w.isPlatform === true ? "IncidentRemediator" : "WorkspaceAdmin",
      capabilities: [],
    })),
  };
}

describe("WorkspaceSwitcher", () => {
  it("renders a dropdown with non-_platform memberships when there are many", () => {
    const session = buildSession([
      { name: "_platform", isPlatform: true },
      { name: "shared-public-experiments" },
      { name: "shared-internal-tools" },
    ]);
    render(
      <SessionProvider session={session}>
        <WorkspaceSwitcher />
      </SessionProvider>,
    );
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    // _platform filtered out; 2 remain.
    expect(options.map((o) => o.textContent)).toEqual([
      "shared-public-experiments",
      "shared-internal-tools",
    ]);
  });

  it("renders a single-workspace label (no dropdown) when only one membership exists", () => {
    const session = buildSession([{ name: "private-deadbeef" }]);
    render(
      <SessionProvider session={session}>
        <WorkspaceSwitcher />
      </SessionProvider>,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("private-deadbeef")).toBeInTheDocument();
  });

  it("renders the zero-membership message when all memberships are filtered", () => {
    const session = buildSession([{ name: "_platform", isPlatform: true }]);
    render(
      <SessionProvider session={session}>
        <WorkspaceSwitcher />
      </SessionProvider>,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getByText(/ask an administrator to grant access/i),
    ).toBeInTheDocument();
  });

  it("updates the active workspace when a new option is chosen", () => {
    const session = buildSession([
      { name: "shared-public-experiments" },
      { name: "shared-internal-tools" },
    ]);
    render(
      <SessionProvider session={session}>
        <WorkspaceSwitcher />
      </SessionProvider>,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("shared-public-experiments");
    fireEvent.change(select, { target: { value: "shared-internal-tools" } });
    expect(select.value).toBe("shared-internal-tools");
  });
});

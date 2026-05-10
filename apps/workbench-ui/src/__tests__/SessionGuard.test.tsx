/**
 * SessionGuard tests — Phase 0.5 / Phase F-rest (2026-05-09).
 *
 * Pins the four guard branches:
 *   1. loading → renders the loading placeholder.
 *   2. authenticated → renders children inside SessionProvider; the
 *      child can read useSession().
 *   3. 401 → redirects to /login (asserted via MemoryRouter route
 *      capturing).
 *   4. non-401 error → renders the inline retry message.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { SessionGuard } from "../components/auth/SessionGuard";
import {
  SecureCoreHttpError,
  type CurrentSessionResponse,
} from "../api/secureCoreClient";
import { useSession } from "../components/auth/SessionContext";

const SESSION: CurrentSessionResponse = {
  user_id: "11111111-1111-4111-8111-111111111111",
  session_id: "22222222-2222-4222-8222-222222222222",
  actor_type: "human",
  assurance_level: "aal2",
  memberships: [
    {
      workspace_id: "33333333-3333-4333-8333-333333333333",
      workspace_name: "shared-public-experiments",
      role_id: "5b807f69-df63-5054-a96a-490c9668a567",
      role_name: "WorkspaceAdmin",
      capabilities: [],
    },
  ],
};

function ProtectedChild(): JSX.Element {
  const { session, activeWorkspaceSlug } = useSession();
  return (
    <div>
      <p data-testid="user-id">{session.user_id}</p>
      <p data-testid="active-slug">{activeWorkspaceSlug}</p>
    </div>
  );
}

describe("SessionGuard", () => {
  it("renders the loading placeholder while the session call is in flight", () => {
    // A fetcher that never resolves keeps the guard in loading state.
    const neverResolves = vi.fn(() => new Promise<CurrentSessionResponse>(() => {}));
    render(
      <MemoryRouter>
        <SessionGuard fetchSession={neverResolves}>
          <ProtectedChild />
        </SessionGuard>
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/loading session/i);
  });

  it("renders children inside SessionProvider after a successful session call", async () => {
    const stub = vi.fn(async () => SESSION);
    render(
      <MemoryRouter>
        <SessionGuard fetchSession={stub}>
          <ProtectedChild />
        </SessionGuard>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user-id")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("user-id")).toHaveTextContent(SESSION.user_id);
    expect(screen.getByTestId("active-slug")).toHaveTextContent(
      "shared-public-experiments",
    );
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("redirects to /login on 401", async () => {
    const stub = vi.fn(async () => {
      throw new SecureCoreHttpError(
        "Authentication required.",
        401,
        "UNAUTHENTICATED",
        "req-id-test",
      );
    });
    render(
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route
            path="/protected"
            element={
              <SessionGuard fetchSession={stub}>
                <ProtectedChild />
              </SessionGuard>
            }
          />
          <Route
            path="/login"
            element={<p data-testid="login-page">Login</p>}
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("login-page")).toBeInTheDocument(),
    );
  });

  it("renders the retry message on a non-401 error", async () => {
    const stub = vi.fn(async () => {
      throw new Error("Network down");
    });
    render(
      <MemoryRouter>
        <SessionGuard fetchSession={stub}>
          <ProtectedChild />
        </SessionGuard>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/Network down/);
  });
});

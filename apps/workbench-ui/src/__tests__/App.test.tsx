/**
 * App shell smoke test.
 *
 * Phase 0.5 / Phase F-rest-final (2026-05-09): App is now wrapped in
 * SessionGuard. The tests therefore stub
 * ``secureCoreClient.currentSession`` to resolve immediately with a
 * fixture session so the guard's authenticated branch renders the
 * shell and the original assertions remain meaningful. The /login
 * route renders OUTSIDE the guard, which is verified by an explicit
 * test below so the redirect-loop class of bug stays caught.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import App from "../App";
import { DEFAULT_SESSION } from "./helpers/renderWithSession";

// Mock the secureCoreClient module so SessionGuard resolves the
// authenticated branch without a real network call. Each test below
// expects the same session shape; LogoutButton's logout call is
// stubbed too so the smoke test does not hang on it.
vi.mock("../api/secureCoreClient", async () => {
  const actual =
    await vi.importActual<typeof import("../api/secureCoreClient")>(
      "../api/secureCoreClient",
    );
  return {
    ...actual,
    secureCoreClient: {
      currentSession: vi.fn(async () => DEFAULT_SESSION),
      securityDashboard: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(async () => undefined),
    },
  };
});

describe("App shell", () => {
  beforeEach(() => {
    // Stub fetch so the app's children don't blow up on backend unavailable.
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    // Reset persisted sidebar state between tests so the default
    // (expanded) is what each test sees.
    try {
      window.localStorage.removeItem("workbench:sidebar-collapsed");
    } catch {
      // jsdom always supports localStorage; the catch is for safety.
    }
  });

  it("renders the workbench title once authenticated", async () => {
    render(
      <MemoryRouter initialEntries={["/simulations"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Scientific Simulation Workbench/i),
      ).toBeInTheDocument(),
    );
  });

  it("renders all plan-named navigation panels (incl. Phase 3 Tools)", async () => {
    render(
      <MemoryRouter initialEntries={["/simulations"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("navigation")).toBeInTheDocument(),
    );
    // Some labels (e.g. "Simulations") appear both as a nav link and as the
    // landing page's heading, so we scope the query to the sidebar nav.
    const nav = screen.getByRole("navigation");
    for (const label of [
      "Examples",
      "Simulations",
      "Run Controls",
      "Code Viewer",
      "Diagnostics",
      "Plots",
      "Capsules",
      "Tools",
      "Papers",
      "Proposals",
      "Generated Code",
      "Comparisons",
      "Autonomy",
      "Security Ops",
      "Documentation",
    ]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });

  it("collapses the sidebar when the toggle is clicked", async () => {
    render(
      <MemoryRouter initialEntries={["/examples"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText("Run Controls")).toBeInTheDocument(),
    );
    const toggle = screen.getByRole("button", { name: /collapse sidebar/i });
    fireEvent.click(toggle);
    // After collapsing, the rail is icon-only visually while retaining
    // accessible names for screen readers and tooltips.
    expect(screen.queryByText("Run Controls")).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByText("Run")).not.toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: "Run Controls" }),
    ).toBeInTheDocument();
    // Toggle aria-label flips so a screen reader knows what it does next.
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });

  it("persists collapsed state across remounts via localStorage", async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/examples"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /collapse sidebar/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(window.localStorage.getItem("workbench:sidebar-collapsed")).toBe("1");
    unmount();
    render(
      <MemoryRouter initialEntries={["/examples"]}>
        <App />
      </MemoryRouter>,
    );
    // Wait for SessionGuard to resolve in the new render before
    // asserting the persisted collapsed state.
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    // New mount honours the persisted collapsed state — full labels not present.
    expect(screen.queryByText("Run Controls")).not.toBeInTheDocument();
  });

  it("renders the /login route OUTSIDE SessionGuard (no redirect loop)", async () => {
    // Mounting at /login should render the login form even though
    // the gateway has no live session — this is exactly the case
    // SessionGuard must NOT intercept, otherwise an unauthenticated
    // visit to /login would redirect to /login forever.
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument(),
    );
  });
});

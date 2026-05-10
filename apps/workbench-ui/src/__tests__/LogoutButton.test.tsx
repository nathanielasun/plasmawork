/**
 * LogoutButton tests — Phase 0.5 / Phase F-rest (2026-05-09).
 *
 * Pins:
 *   1. happy path: click → calls logout() → navigates to /login.
 *   2. network error: click → swallows the error → still navigates
 *      to /login (the gateway is idempotent on its side).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { LogoutButton } from "../components/auth/LogoutButton";

describe("LogoutButton", () => {
  it("calls logout() then navigates to /login on success", async () => {
    const stub = vi.fn(async () => undefined);
    render(
      <MemoryRouter initialEntries={["/somewhere"]}>
        <Routes>
          <Route
            path="/somewhere"
            element={<LogoutButton logout={stub} />}
          />
          <Route
            path="/login"
            element={<p data-testid="login-page">Login</p>}
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(stub).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("login-page")).toBeInTheDocument(),
    );
  });

  it("navigates to /login even when the logout call fails", async () => {
    const stub = vi.fn(async () => {
      throw new Error("network down");
    });
    render(
      <MemoryRouter initialEntries={["/somewhere"]}>
        <Routes>
          <Route
            path="/somewhere"
            element={<LogoutButton logout={stub} />}
          />
          <Route
            path="/login"
            element={<p data-testid="login-page">Login</p>}
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(stub).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("login-page")).toBeInTheDocument(),
    );
  });
});

/**
 * LoginForm test — Phase 0.5 / Phase F-min (2026-05-09).
 *
 * Pins the login form's contract:
 *   - happy path: valid credentials → calls login() with the typed
 *     body → fires onSuccess with the response.
 *   - 401 path: same generic error message regardless of cause
 *     (anti-enumeration; matches gateway's LoginService).
 *   - shape rejection: client-side username regex catches malformed
 *     input before any network call.
 *
 * No real fetch is exercised; the test injects a stub `login` prop so
 * the form's wiring is verified without standing up a real gateway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LoginForm } from "../components/auth/LoginForm";
import {
  SecureCoreHttpError,
  type LoginRequestBody,
  type LoginResponseBody,
} from "../api/secureCoreClient";

const HAPPY_RESPONSE: LoginResponseBody = {
  user_id: "11111111-1111-4111-8111-111111111111",
  session_id: "22222222-2222-4222-8222-222222222222",
  assurance_level: "aal2",
  csrf_token: "raw_csrf_token_for_test",
  expires_at: "2026-05-10T00:00:00.000Z",
};

describe("LoginForm", () => {
  let onSuccess: ReturnType<typeof vi.fn>;
  let loginCalls: LoginRequestBody[];

  beforeEach(() => {
    onSuccess = vi.fn();
    loginCalls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits username + password and calls onSuccess on 200", async () => {
    const stubLogin = vi.fn(async (body: LoginRequestBody) => {
      loginCalls.push(body);
      return HAPPY_RESPONSE;
    });

    render(<LoginForm onSuccess={onSuccess} login={stubLogin} />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "rootadmin42x9k" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "supersecret-password-1234" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith(HAPPY_RESPONSE);
    expect(loginCalls).toEqual([
      { username: "rootadmin42x9k", password: "supersecret-password-1234" },
    ]);
  });

  it("renders generic error on 401 (anti-enumeration)", async () => {
    const stubLogin = vi.fn(async () => {
      throw new SecureCoreHttpError(
        "Invalid username or password.",
        401,
        "UNAUTHENTICATED",
        "req-id-test",
      );
    });

    render(<LoginForm onSuccess={onSuccess} login={stubLogin} />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "rootadmin42x9k" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid username or password.",
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("renders generic error on 403 (Origin mismatch — same UI shape)", async () => {
    const stubLogin = vi.fn(async () => {
      throw new SecureCoreHttpError(
        "Origin or Referer not in allowlist.",
        403,
        "ORIGIN_MISMATCH",
        "req-id-test",
      );
    });

    render(<LoginForm onSuccess={onSuccess} login={stubLogin} />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "rootadmin42x9k" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "any-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid username or password.",
    );
  });

  it("rejects malformed username before any network call", async () => {
    const stubLogin = vi.fn(async () => HAPPY_RESPONSE);

    render(<LoginForm onSuccess={onSuccess} login={stubLogin} />);

    fireEvent.change(screen.getByLabelText("Username"), {
      // Disallowed chars (space + @ ).
      target: { value: "bad user@host" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "any-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid username or password.",
    );
    expect(stubLogin).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("rejects empty password without calling network", async () => {
    const stubLogin = vi.fn(async () => HAPPY_RESPONSE);

    render(<LoginForm onSuccess={onSuccess} login={stubLogin} />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "rootadmin42x9k" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(stubLogin).not.toHaveBeenCalled();
  });

  it("renders the more-specific message on a 5xx error", async () => {
    const stubLogin = vi.fn(async () => {
      throw new SecureCoreHttpError(
        "Internal server error",
        500,
        "INTERNAL_ERROR",
        "req-id-test",
      );
    });

    render(<LoginForm onSuccess={onSuccess} login={stubLogin} />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "rootadmin42x9k" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "any-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/HTTP 500/);
  });
});

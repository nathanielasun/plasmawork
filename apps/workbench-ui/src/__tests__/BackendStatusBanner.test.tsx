/**
 * Tests for the BackendStatusBanner component.
 *
 * Probes /dev-status on mount; renders one of three states (stub /
 * live / error). Pinned here so a future refactor that flips the
 * default visibility ("don't render in live mode," etc.) is an
 * intentional, reviewed change.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import BackendStatusBanner from "../components/system/BackendStatusBanner";

function mockFetchOnce(status: number, body: unknown): void {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (() => Promise.resolve(response)) as typeof fetch,
  );
}

describe("BackendStatusBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders the stub label + hint when /dev-status returns 200', async () => {
    mockFetchOnce(200, {
      mode: "stub",
      hint: "Run scripts/dev/run_gateway.sh for real auth.",
    });
    render(<BackendStatusBanner />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute("data-mode", "stub");
    });
    expect(screen.getByText(/Dev stub gateway/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Run scripts\/dev\/run_gateway\.sh/i),
    ).toBeInTheDocument();
  });

  it('renders the live label when /dev-status returns 404', async () => {
    mockFetchOnce(404, { error: "not_found" });
    render(<BackendStatusBanner />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute("data-mode", "live");
    });
    expect(screen.getByText(/Live backend/i)).toBeInTheDocument();
  });

  it('renders the error label + detail on network failure', async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (() => Promise.reject(new TypeError("ECONNREFUSED"))) as typeof fetch,
    );
    render(<BackendStatusBanner />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute("data-mode", "error");
    });
    expect(screen.getByText(/Backend unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/i)).toBeInTheDocument();
  });

  it("renders nothing until the first probe resolves", () => {
    // Promise never resolves — the banner should stay in "loading"
    // state and render null.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (() => new Promise<Response>(() => {})) as typeof fetch,
    );
    const { container } = render(<BackendStatusBanner />);
    expect(container.firstChild).toBeNull();
  });
});

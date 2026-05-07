/**
 * SecurityOperationsPanel tests.
 *
 * These assert the UI binds to live secure-core routes when available and
 * labels fixture fallback clearly when they are not mounted locally.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SecurityOperationsPanel from "../components/security/SecurityOperationsPanel";
import {
  secureCoreDashboardFixture,
  secureCoreSessionFixture,
} from "../api/secureCoreFixtures";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecurityOperationsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders live session and dashboard state when secure-core routes respond", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/auth/session")) {
        return jsonResponse(secureCoreSessionFixture);
      }
      if (url.endsWith("/operator/security-dashboard")) {
        return jsonResponse({
          ...secureCoreDashboardFixture,
          status: "healthy",
          deniedAccess: [],
          sandboxViolations: [],
        });
      }
      return jsonResponse({}, 404);
    });

    render(<SecurityOperationsPanel />);

    await waitFor(() => {
      expect(screen.getByText("live backend")).toBeInTheDocument();
      expect(screen.getByText("Platform Operator")).toBeInTheDocument();
      expect(screen.getAllByText("healthy").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("platform:audit_read")).toBeInTheDocument();
  });

  it("falls back to explicit fixtures and disables fail-closed routes", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      jsonResponse(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "No secure-core session.",
            request_id: "req_fixture",
          },
        },
        401,
      ),
    );

    render(<SecurityOperationsPanel />);

    await waitFor(() => {
      expect(screen.getByText("fixture fallback")).toBeInTheDocument();
      expect(screen.getByText(/Secure-core endpoint unavailable/i)).toBeInTheDocument();
      expect(screen.getAllByText("operator.remediate").length).toBeGreaterThan(0);
    });
    expect(
      screen.getAllByRole("button", {
        name: /Disabled until backend readiness changes/i,
      })[0],
    ).toBeDisabled();
  });
});

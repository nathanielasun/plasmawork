/**
 * ToolPromotionPanel tests — Phase α.4 (2026-05-10).
 *
 * Pins:
 *   1. Without ``platform:incident_remediate``, the panel renders
 *      the access-denied copy and does NOT call the listing API.
 *   2. With the capability, the panel lists pending requests + each
 *      row has approve / deny buttons.
 *   3. Clicking Approve fires ``approveToolPromotion`` and refreshes
 *      the listing.
 *   4. Clicking Deny fires ``denyToolPromotion`` and refreshes.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SessionProvider } from "../components/auth/SessionContext";
import { ToolPromotionPanel } from "../components/tools/ToolPromotionPanel";
import type {
  ApiClient,
  ToolPromotionRequest,
} from "../api/client";
import type { CurrentSessionResponse } from "../api/secureCoreClient";

const PENDING: ToolPromotionRequest = {
  request_id: "11111111-1111-4111-8111-111111111111",
  tool_name: "_pytest_promote_demo",
  from_workspace_slug: "shared-public-experiments",
  to_workspace_slug: "shared-internal-tools",
  requested_by: "user_alice",
  requested_at: "2026-05-10T08:00:00Z",
  justification: "Vetted; ready for system-wide use",
  status: "pending",
};

function buildSession(
  capabilities: readonly string[],
): CurrentSessionResponse {
  return {
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
        // ``capabilities`` is a closed Capability union, so cast at the test
        // boundary. The component reads via includes().
        capabilities: capabilities as readonly never[],
      },
    ],
  };
}

function buildApi(overrides: Partial<ApiClient>): ApiClient {
  const approved: ToolPromotionRequest = { ...PENDING, status: "approved" };
  const denied: ToolPromotionRequest = { ...PENDING, status: "denied" };
  const stub: Partial<ApiClient> = {
    listToolPromotions: vi.fn(async () => [PENDING]),
    approveToolPromotion: vi.fn(async () => approved),
    denyToolPromotion: vi.fn(async () => denied),
    ...overrides,
  };
  return stub as ApiClient;
}

describe("ToolPromotionPanel", () => {
  it("renders access-denied copy when capability is absent", async () => {
    const api = buildApi({});
    render(
      <SessionProvider session={buildSession([])}>
        <ToolPromotionPanel api={api} />
      </SessionProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/platform:incident_remediate/),
      ).toBeInTheDocument(),
    );
    // List API was NOT called.
    expect(api.listToolPromotions).not.toHaveBeenCalled();
  });

  it("lists pending requests when capability is present", async () => {
    const api = buildApi({});
    render(
      <SessionProvider
        session={buildSession(["platform:incident_remediate"])}
      >
        <ToolPromotionPanel api={api} />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("_pytest_promote_demo")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/shared-public-experiments → shared-internal-tools/),
    ).toBeInTheDocument();
    expect(api.listToolPromotions).toHaveBeenCalledTimes(1);
  });

  it("approves a request and refreshes", async () => {
    const api = buildApi({});
    render(
      <SessionProvider
        session={buildSession(["platform:incident_remediate"])}
      >
        <ToolPromotionPanel api={api} />
      </SessionProvider>,
    );
    await waitFor(() => screen.getByText("_pytest_promote_demo"));

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(api.approveToolPromotion).toHaveBeenCalledWith(
        PENDING.request_id,
        { decision_note: "" },
      ),
    );
    // listToolPromotions called twice: initial mount + post-decision refresh.
    expect(api.listToolPromotions).toHaveBeenCalledTimes(2);
  });

  it("denies a request and refreshes", async () => {
    const api = buildApi({});
    render(
      <SessionProvider
        session={buildSession(["platform:incident_remediate"])}
      >
        <ToolPromotionPanel api={api} />
      </SessionProvider>,
    );
    await waitFor(() => screen.getByText("_pytest_promote_demo"));

    fireEvent.click(screen.getByRole("button", { name: /^deny$/i }));
    await waitFor(() =>
      expect(api.denyToolPromotion).toHaveBeenCalledTimes(1),
    );
    expect(api.listToolPromotions).toHaveBeenCalledTimes(2);
  });

  it("shows empty-state copy when no pending requests", async () => {
    const api = buildApi({ listToolPromotions: vi.fn(async () => []) });
    render(
      <SessionProvider
        session={buildSession(["platform:incident_remediate"])}
      >
        <ToolPromotionPanel api={api} />
      </SessionProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/no pending requests/i)).toBeInTheDocument(),
    );
  });
});

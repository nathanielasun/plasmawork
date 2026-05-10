/**
 * Test helper: render a component tree inside a SessionProvider —
 * Phase 0.5 / Phase F-rest-final (2026-05-09).
 *
 * Use this for tests that mount components which call ``useSession()``
 * directly (or transitively, via WorkspaceSwitcher / LogoutButton /
 * any future hook reading the context). The default session is a
 * plausible authenticated human in a single workspace; callers can
 * override fields by passing a partial session.
 *
 * The helper wraps in a MemoryRouter so any react-router consumers
 * (NavLink, useNavigate) work without each test rolling its own
 * router. Pass ``initialEntries`` to seed the route.
 *
 * For tests that mount the FULL App with SessionGuard, use
 * ``renderAppWithMockedSession`` instead — it stubs the
 * ``secureCoreClient.currentSession`` call so SessionGuard resolves
 * the authenticated branch immediately.
 */
import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { CurrentSessionResponse } from "../../api/secureCoreClient";
import { SessionProvider } from "../../components/auth/SessionContext";

export const DEFAULT_SESSION: CurrentSessionResponse = {
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

export interface RenderWithSessionOptions {
  readonly session?: CurrentSessionResponse;
  readonly initialEntries?: readonly string[];
  readonly initialActiveWorkspaceSlug?: string;
}

export function renderWithSession(
  ui: ReactElement,
  options: RenderWithSessionOptions = {},
): RenderResult {
  const session = options.session ?? DEFAULT_SESSION;
  const entries = options.initialEntries ?? ["/"];
  return render(
    <MemoryRouter initialEntries={[...entries]}>
      <SessionProvider
        session={session}
        initialActiveWorkspaceSlug={options.initialActiveWorkspaceSlug}
      >
        {ui}
      </SessionProvider>
    </MemoryRouter>,
  );
}

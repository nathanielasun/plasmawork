/**
 * Session context — Phase 0.5 / Phase F-rest (2026-05-09).
 *
 * Holds the live session response from ``/auth/session`` plus the
 * active workspace slug. Components that need to know "who am I?" and
 * "which workspace am I in?" subscribe through ``useSession``.
 *
 * The context is intentionally NOT global state in a Redux/Zustand
 * sense — it carries server-derived identity, never client state.
 * Anything mutable (the active workspace selection) is the only
 * field with a setter, and even that is constrained: setActiveSlug
 * MUST be a member of session.memberships, otherwise the gateway will
 * 404 every subsequent request.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  CurrentSessionMembership,
  CurrentSessionResponse,
} from "../../api/secureCoreClient.js";

export interface SessionContextValue {
  readonly session: CurrentSessionResponse;
  readonly activeWorkspaceSlug: string;
  readonly activeMembership: CurrentSessionMembership | null;
  readonly setActiveWorkspaceSlug: (slug: string) => void;
}

const SessionContextInternal = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  readonly session: CurrentSessionResponse;
  /**
   * Initial active workspace slug. Defaults to the workspace_name of
   * the first non-platform membership; falls back to the first
   * membership if the user only has a platform membership; falls back
   * to the empty string for the synthetic single-membership-less
   * test case.
   */
  readonly initialActiveWorkspaceSlug?: string;
  readonly children: ReactNode;
}

function pickDefaultSlug(
  session: CurrentSessionResponse,
): string {
  const memberships = session.memberships;
  if (memberships.length === 0) return "";
  const nonPlatform = memberships.find(
    (m) => m.workspace_name !== "_platform",
  );
  return (nonPlatform ?? memberships[0]!).workspace_name;
}

export function SessionProvider(props: SessionProviderProps): JSX.Element {
  const initial =
    props.initialActiveWorkspaceSlug ?? pickDefaultSlug(props.session);
  const [activeWorkspaceSlug, setActiveWorkspaceSlug] = useState(initial);

  const value = useMemo<SessionContextValue>(() => {
    const activeMembership =
      props.session.memberships.find(
        (m) => m.workspace_name === activeWorkspaceSlug,
      ) ?? null;
    return {
      session: props.session,
      activeWorkspaceSlug,
      activeMembership,
      setActiveWorkspaceSlug,
    };
  }, [props.session, activeWorkspaceSlug]);

  return (
    <SessionContextInternal.Provider value={value}>
      {props.children}
    </SessionContextInternal.Provider>
  );
}

/**
 * Hook to read the current session. Throws if called outside a
 * SessionProvider — the SessionGuard ensures a provider is always
 * present before authenticated UI renders.
 */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContextInternal);
  if (value === null) {
    throw new Error(
      "useSession: no SessionProvider in scope. Wrap the protected UI in SessionGuard or, in tests, in <SessionProvider session={...}>.",
    );
  }
  return value;
}

/**
 * Variant that returns null instead of throwing — useful for
 * components rendered in both authenticated and unauthenticated
 * contexts (rare; SessionGuard short-circuits the unauthenticated
 * path before the route handlers render).
 */
export function useSessionOptional(): SessionContextValue | null {
  return useContext(SessionContextInternal);
}

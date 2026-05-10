/**
 * SessionGuard — Phase 0.5 / Phase F-rest (2026-05-09).
 *
 * Wraps a tree that requires authentication. On mount calls
 * ``GET /auth/session``:
 *   - 200 → renders children inside a SessionProvider
 *   - 401 → redirects to /login
 *   - other error → renders an inline retry message (most likely a
 *     gateway / network outage)
 *
 * The redirect target is fixed at /login. Production wires this
 * around the App router; tests can mount it directly with a stub
 * fetcher to verify each branch without a real network round-trip.
 */
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import {
  secureCoreClient,
  SecureCoreHttpError,
  type CurrentSessionResponse,
} from "../../api/secureCoreClient.js";
import { SessionProvider } from "./SessionContext.js";

export interface SessionGuardProps {
  readonly children: React.ReactNode;
  /**
   * Override for tests — the fetcher that resolves the current
   * session. Defaults to ``secureCoreClient.currentSession``.
   */
  readonly fetchSession?: typeof secureCoreClient.currentSession;
  /**
   * Path to redirect to when the session is missing. Defaults to
   * ``/login``.
   */
  readonly loginPath?: string;
}

type GuardState =
  | { readonly tag: "loading" }
  | { readonly tag: "authenticated"; readonly session: CurrentSessionResponse }
  | { readonly tag: "unauthenticated" }
  | { readonly tag: "error"; readonly message: string };

export function SessionGuard(props: SessionGuardProps): JSX.Element {
  const [state, setState] = useState<GuardState>({ tag: "loading" });
  const fetchSession = props.fetchSession ?? secureCoreClient.currentSession;
  const loginPath = props.loginPath ?? "/login";

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetchSession(controller.signal)
      .then((session) => {
        if (cancelled) return;
        setState({ tag: "authenticated", session });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof SecureCoreHttpError && err.status === 401) {
          setState({ tag: "unauthenticated" });
          return;
        }
        const message =
          err instanceof Error ? err.message : "Could not reach the gateway.";
        setState({ tag: "error", message });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchSession]);

  if (state.tag === "loading") {
    return (
      <div className="session-guard-loading" role="status" aria-live="polite">
        <p>Loading session…</p>
      </div>
    );
  }
  if (state.tag === "unauthenticated") {
    return <Navigate to={loginPath} replace />;
  }
  if (state.tag === "error") {
    return (
      <div className="session-guard-error" role="alert">
        <p>Could not load your session: {state.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <SessionProvider session={state.session}>{props.children}</SessionProvider>
  );
}

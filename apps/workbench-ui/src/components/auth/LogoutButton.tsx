/**
 * LogoutButton — Phase 0.5 / Phase F-rest (2026-05-09).
 *
 * Calls ``POST /auth/logout`` and redirects to /login on completion.
 * The endpoint is idempotent on the gateway side: it ALWAYS clears
 * both cookies regardless of whether the session-revocation
 * succeeded, so even a partial server-side failure leaves the
 * browser in a consistent unauthenticated state.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { secureCoreClient } from "../../api/secureCoreClient.js";

export interface LogoutButtonProps {
  /**
   * Override for tests. Defaults to ``secureCoreClient.logout``.
   */
  readonly logout?: typeof secureCoreClient.logout;
  /**
   * Path to navigate to after logout completes. Defaults to ``/login``.
   */
  readonly loginPath?: string;
  readonly className?: string;
}

export function LogoutButton(props: LogoutButtonProps = {}): JSX.Element {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const fn = props.logout ?? secureCoreClient.logout;
  const loginPath = props.loginPath ?? "/login";

  async function handleClick(): Promise<void> {
    setPending(true);
    try {
      await fn();
    } catch {
      // The gateway clears cookies even on revocation failure; even
      // if our network call dies we still want the user redirected
      // to the login page. Swallow the error and proceed.
    }
    navigate(loginPath, { replace: true });
  }

  return (
    <button
      type="button"
      className={props.className ?? "logout-button"}
      onClick={handleClick}
      disabled={pending}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

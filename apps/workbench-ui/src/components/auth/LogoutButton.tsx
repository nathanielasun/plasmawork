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
    let serverFailed = false;
    try {
      await fn();
    } catch {
      // Audit fix (2026-05-09): the gateway needs an authenticated +
      // CSRF-echoing logout to revoke the session row and clear the
      // cookies. The previous implementation swallowed the error and
      // navigated away, leaving a stale server session. We still
      // navigate (defense in depth — the user almost certainly wants
      // off this page), but record the failure on the next render so
      // the user can decide whether to clear cookies manually.
      serverFailed = true;
    }
    setPending(false);
    if (serverFailed) {
      // eslint-disable-next-line no-console
      console.warn(
        "Logout request failed; the server-side session may still be active. " +
          "Cookies will be cleared if this is the gateway's expected behavior, but " +
          "consider closing the browser tab to be safe.",
      );
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

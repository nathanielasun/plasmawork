/**
 * Login form — Phase 0.5 / Phase F-min (2026-05-09).
 *
 * Username + password form posting to ``POST /auth/login``. On
 * success the gateway sets the ``secure_session`` (HttpOnly) and
 * ``csrf_token`` (non-HttpOnly) cookies; the response body carries
 * the user / session ids + the CSRF token + the expiry.
 *
 * Anti-enumeration (v4 §8): every login failure renders the SAME
 * generic error message ("Invalid username or password.") regardless
 * of cause — unknown username, wrong password, locked account.
 * Discriminating between them is the audit chain's job, not the
 * UI's.
 *
 * Visual contract: the form lives in a card-shaped panel matching
 * STYLING.md tokens. No new design tokens are introduced here.
 */
import { useState, type FormEvent } from "react";

import {
  secureCoreClient,
  SecureCoreHttpError,
  type LoginResponseBody,
} from "../../api/secureCoreClient.js";

const GENERIC_AUTH_FAILURE_MESSAGE = "Invalid username or password.";
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

export interface LoginFormProps {
  /**
   * Called after a successful login. Production wires it to a
   * `react-router` navigation; tests inspect the call to assert the
   * happy-path branch fired.
   */
  readonly onSuccess: (response: LoginResponseBody) => void;
  /**
   * Override for tests so they don't hit the real fetch boundary.
   * Defaults to the module-level `secureCoreClient.login`.
   */
  readonly login?: typeof secureCoreClient.login;
}

export function LoginForm({ onSuccess, login }: LoginFormProps): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    // Client-side shape check — keeps a malformed username from
    // hitting the network at all. The gateway also enforces this
    // regex; the duplicate is intentional (defense in depth).
    if (!USERNAME_PATTERN.test(username)) {
      setError(GENERIC_AUTH_FAILURE_MESSAGE);
      return;
    }
    if (password.length === 0) {
      setError(GENERIC_AUTH_FAILURE_MESSAGE);
      return;
    }

    setSubmitting(true);
    try {
      const fn = login ?? secureCoreClient.login;
      const response = await fn({ username, password });
      onSuccess(response);
    } catch (err) {
      if (
        err instanceof SecureCoreHttpError &&
        (err.status === 401 || err.status === 403)
      ) {
        // Anti-enumeration: ANY 4xx auth failure → generic message.
        setError(GENERIC_AUTH_FAILURE_MESSAGE);
      } else if (err instanceof SecureCoreHttpError) {
        // 5xx or 400 (e.g. malformed body) — show a separate
        // diagnostic so the user can tell the server is down vs.
        // their credentials are wrong.
        setError(`Login failed (HTTP ${err.status}). Try again or contact your operator.`);
      } else {
        setError("Network error. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-card">
      <h1 className="login-title">Sign in to Workbench</h1>
      <form className="login-form" onSubmit={handleSubmit} noValidate>
        <label className="login-field">
          <span>Username</span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
            aria-required="true"
            aria-invalid={error !== null}
            minLength={3}
            maxLength={64}
          />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            aria-required="true"
            aria-invalid={error !== null}
          />
        </label>
        {error !== null && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="login-submit"
          disabled={submitting}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

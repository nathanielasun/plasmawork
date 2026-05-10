/**
 * /login route — Phase 0.5 / Phase F-min (2026-05-09).
 *
 * Renders the LoginForm. On a successful login, navigates to ``/``
 * via react-router's ``useNavigate``. Production wires this page into
 * the App shell once SessionGuard ships in F-rest; for now it's an
 * importable component the host can register at the route directly.
 */
import { useNavigate } from "react-router-dom";

import { LoginForm } from "../../components/auth/LoginForm.js";

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="login-shell">
      <LoginForm
        onSuccess={() => {
          // After a successful login, redirect to the app root. The
          // SessionGuard (F-rest) will then call /auth/session and
          // render the workbench against the user's primary
          // workspace.
          navigate("/", { replace: true });
        }}
      />
    </div>
  );
}

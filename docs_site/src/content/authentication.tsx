export default function SecurityAuthentication() {
  return (
    <article>
      <h1>Security: Authentication</h1>
      <p className="page-status">
        This page describes the public authentication model, the Phase 0.5
        auth-gateway operator workflow, and the user-facing login flow.
        Provider internals, raw secret values, and deployment-specific
        identity-provider setup remain in deployment runbooks.
      </p>

      <h2>Principles</h2>
      <ul>
        <li>Authenticated identity is derived server-side from a verified session, never from a request body.</li>
        <li>Actor type is explicit: human, AI agent, worker, operator, or unauthenticated rejection path.</li>
        <li>Session state is short-lived, revocable, and scoped to current workspace membership.</li>
        <li>Protected routes fail closed when authentication, validation, audit, or capability checks are unavailable.</li>
        <li>Username is the primary login identifier; email is optional metadata used only for recovery notifications.</li>
      </ul>

      <h2>Architecture: gateway in front, FastAPI behind</h2>
      <p>
        The Phase 0.5 auth gateway runs as a Fastify host at
        <code>apps/workbench-gateway/</code> and is the public entry. It
        composes secure-core's exported route plugins (login, auth,
        bootstrap, workspaces, capsules, runs, tools, operator,
        security-dashboard) and proxies authorized
        <code>/api/&#123;workspace_slug&#125;/*</code> requests to the
        existing FastAPI workbench at
        <code>packages/core/src/simworkbench/api/server.py</code>. The
        FastAPI process binds to <code>127.0.0.1</code> only; a different
        host on the network cannot reach it.
      </p>
      <p>
        Three defenses compose the gateway-FastAPI handoff:
      </p>
      <ul>
        <li>
          <strong>HMAC-signed handoff headers</strong> — every forwarded
          request carries seven <code>X-Workbench-*</code> headers signed
          with <code>WORKBENCH_GATEWAY_HANDOFF_SECRET</code> (HMAC-SHA256).
          The FastAPI middleware recomputes the same HMAC and
          constant-time-compares; spoofed headers from a colocated
          process are rejected.
        </li>
        <li>
          <strong>Loopback bind</strong> — enforced by
          <code>scripts/dev/run_backend.py</code>'s pinned
          <code>DEFAULT_HOST</code>. The convention checker keeps the
          literal in place.
        </li>
        <li>
          <strong>URL slug cross-check</strong> — opt-in via the
          <code>slug_prefixed_paths</code> argument on
          <code>WorkbenchHandoffMiddleware</code>. Defaults to empty:
          today's gateway strips the workspace slug from the URL before
          proxying, so there is no slug at the FastAPI side to
          cross-check. The flag becomes load-bearing once FastAPI adopts
          <code>/api/&#123;slug&#125;/&#123;rest&#125;</code> routes.
        </li>
      </ul>

      <h2>Gateway route authorization</h2>
      <p>
        The gateway does not rely on UI button visibility or FastAPI route
        comments for authorization. State-changing proxied FastAPI routes are
        listed in a server-side capability map. Each entry declares the
        workspace capabilities and, when needed, platform capabilities required
        before forwarding. A state-changing route that lacks a map entry fails
        closed at the gateway boundary.
      </p>
      <p>
        Platform capabilities are derived from server-side membership and role
        records across the relevant platform scope, not from the active
        workspace's role list and never from a request body. This is why a
        PlatformAdmin can decide a cross-workspace promotion while a regular
        WorkspaceAdmin cannot.
      </p>

      <h2>Where the env vars live</h2>
      <p>
        <code>/.env.auth</code> at the repo root is the canonical
        authentication config. The committed
        <code>.env.auth.example</code> lists every variable the loader at
        <code>apps/workbench-gateway/src/env.ts</code> requires;
        <code>.env.auth</code> itself is gitignored. The loader fails
        closed at startup if any variable is missing or shorter than its
        security floor (32 bytes for the cookie + handoff secrets).
      </p>
      <p>The variables fall into four groups:</p>
      <ul>
        <li>
          <strong>Bootstrap</strong> — <code>BOOTSTRAP_ALLOWED</code>,
          <code>BOOTSTRAP_CREDENTIAL_HASH</code>,
          <code>ROOT_ADMIN_USER_ID</code>.
        </li>
        <li>
          <strong>Gateway runtime</strong> —
          <code>WORKBENCH_GATEWAY_HOST</code> (default
          <code>127.0.0.1</code>; set to <code>0.0.0.0</code> only when
          fronted by a TLS terminator),
          <code>WORKBENCH_GATEWAY_PORT</code>,
          <code>WORKBENCH_BACKEND_PORT</code>,
          <code>WORKBENCH_GATEWAY_COOKIE_SECRET</code>,
          <code>WORKBENCH_GATEWAY_HANDOFF_SECRET</code>,
          <code>WORKBENCH_INTERNAL_AUDIT_SECRET</code> (distinct from
          the handoff secret; signs the gateway-internal canonical
          audit bridge so a future FastAPI compromise cannot forge
          audit-chain entries),
          <code>WORKBENCH_GATEWAY_FRONTEND_ORIGIN</code>.
        </li>
        <li>
          <strong>Database connections</strong> —
          <code>PLASMAWORK_DB_URL</code>,
          <code>PLASMAWORK_DB_AUDIT_URL</code>.
        </li>
        <li>
          <strong>Trust-proxy + WORM</strong> —
          <code>WORKBENCH_GATEWAY_TRUST_PROXY</code> (empty/unset by
          default so direct clients cannot rotate
          <code>X-Forwarded-For</code>) and
          <code>WORKBENCH_BOOTSTRAP_WORM_PROVIDER</code> (<code>s3</code>
          for production, <code>fake</code> for single-node dev) plus the
          S3 bucket / key / region triple when the provider is S3.
        </li>
      </ul>

      <h2>First-boot bootstrap</h2>
      <p>
        Bootstrap creates the seeded root admin once and then seals
        itself with a write-once WORM marker. Re-bootstrap is
        intentionally hard; lost-admin recovery is the manual runbook
        below (and in <code>LIMITATIONS.md</code>).
      </p>
      <ol>
        <li>
          Choose a username (alphanumeric + <code>_-</code>, 3–64 chars)
          and a one-time out-of-band credential string. Hash the OOB
          credential and paste the digest into
          <code>BOOTSTRAP_CREDENTIAL_HASH</code>:
          <pre>
            <code>{`# Linux: sha256sum. macOS: shasum -a 256.
printf '%s' '<your-oob-credential>' | shasum -a 256`}</code>
          </pre>
        </li>
        <li>
          Set <code>ROOT_ADMIN_USER_ID</code> to the chosen username and
          <code>BOOTSTRAP_ALLOWED=1</code>.
        </li>
        <li>
          Set the WORM provider —
          <code>WORKBENCH_BOOTSTRAP_WORM_PROVIDER=s3</code> with
          bucket / key / region in production, or
          <code>fake</code> for a single-node dev box. The gateway
          refuses to start with the in-memory fake when
          <code>BOOTSTRAP_ALLOWED=1</code>.
        </li>
        <li>
          Start the gateway. POST the OOB credential plus a chosen
          password:
          <pre>
            <code>{`curl -X POST http://localhost:4000/bootstrap \\
  -H 'Content-Type: application/json' \\
  -d '{"admin_username":"<ROOT_ADMIN_USER_ID>",
       "admin_password":"<chosen-password>",
       "oob_credential":"<plaintext-OOB>"}'`}</code>
          </pre>
        </li>
        <li>
          The route writes the WORM marker and seeds three workspaces
          (<code>_platform</code>, <code>shared-internal-tools</code>,
          <code>shared-public-experiments</code>) inside one
          transaction, then disappears. Subsequent
          <code>POST /bootstrap</code> requests return 404.
        </li>
      </ol>

      <h2>Login and workspace switching</h2>
      <p>
        Users point their browsers at the gateway's
        <code>/login</code> route. The form posts username + password to
        <code>POST /auth/login</code>; on 200 the gateway sets
        <code>secure_session</code> (HttpOnly) and
        <code>csrf_token</code> (non-HttpOnly) cookies and the SPA
        redirects to <code>/</code>. State-changing requests echo the
        <code>csrf_token</code> cookie value as the
        <code>X-CSRF-Token</code> header (double-submit pattern enforced
        by <code>enforceCsrfForStateChange</code>).
      </p>
      <p>
        The header-mounted <code>WorkspaceSwitcher</code> reads live
        memberships from <code>GET /auth/session</code> and lets the
        user move between <code>shared-internal-tools</code>,
        <code>shared-public-experiments</code>, and their per-user
        <code>private-&#123;8-char-hex&#125;</code> workspace.
        <code>POST /auth/logout</code> revokes the session and clears
        both cookies.
      </p>

      <h2>Operator runbook: lost admin</h2>
      <p>
        There is <strong>no</strong> code-level break-glass env var for
        re-bootstrap. A break-glass would be the most-stolen string in
        the deployment and would make the WORM seal a lie. Recovery is a
        deliberate human operator workflow:
      </p>
      <ol>
        <li>Confirm the admin is genuinely lost; password reset goes through the normal recovery flow.</li>
        <li>Disable the existing admin row in the application database with an operator credential (NOT the app role).</li>
        <li>Invalidate the WORM marker. Production S3 Object Lock COMPLIANCE means the locked object cannot be deleted before its retain-until date; operators either wait, or point the gateway at a NEW bucket / key combination.</li>
        <li>Set a fresh <code>BOOTSTRAP_CREDENTIAL_HASH</code>, restart the gateway with <code>BOOTSTRAP_ALLOWED=1</code>, POST the new OOB credential.</li>
        <li>The original admin's audit chain remains intact; re-bootstrap creates a separate <code>bootstrap.completed</code> row tied to a new <code>admin_user_id</code>.</li>
      </ol>
      <p>
        Full runbook + deferred-MFA notes in
        <code>LIMITATIONS.md</code> under "Authentication gateway: no
        break-glass, manual re-bootstrap".
      </p>

      <h2>Session lifecycle</h2>
      <p>
        A successful sign-in creates a server-verifiable session that
        binds a user to an actor type and a set of live memberships. The
        secure-core boundary recomputes effective roles and capabilities
        from server-side records instead of accepting privilege claims
        from clients.
      </p>
      <p>
        The frontend-facing session introspection route is
        <code>GET /auth/session</code>. It returns server-derived
        identity, assurance level, live workspace memberships, role
        names, and capabilities; it accepts no request body.
      </p>
      <p>
        Password-reset and email-verification consume routes bridge into
        a fresh browser session via
        <code>LoginService.mintSessionForUser</code>. Password-reset
        consume lands at assurance level 2; email-verification consume
        lands at assurance level 1 until a stronger factor is completed.
        Session refresh, revocation, idle timeout, and disabled-user
        handling are part of the authentication boundary; disabling a
        user prevents new privileged work and preserves historical audit
        and provenance rows.
      </p>
      <p>
        Account lockout preserves the same password-verifier call path as an
        ordinary wrong password. The response remains generic, while the audit
        chain records the server-derived denial reason.
      </p>

      <h2>Request handling</h2>
      <ul>
        <li>JSON bodies are validated before handlers perform side effects.</li>
        <li>Protected requests attach authenticated actor context for downstream authorization and audit writers.</li>
        <li>Missing or invalid credentials use a structured unauthenticated response without leaking workspace existence.</li>
        <li>Cross-site request protections and origin checks emit security audit events when they reject a request.</li>
      </ul>

      <h2>Out of scope here</h2>
      <p>
        This page documents the env-var schema, the operator workflow,
        and the user-facing login flow. It does not document raw cookie
        values, generated session tokens, deployment secret identifiers,
        or environment-specific identity-provider integration. Operators
        should use deployment runbooks for environment-specific setup
        and pair this page with ADR-0014 for the architectural rationale.
      </p>
    </article>
  );
}

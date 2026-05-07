export default function SecurityAuthentication() {
  return (
    <article>
      <h1>Security: Authentication</h1>
      <p className="page-status">
        This page describes the public authentication model at a policy level.
        Implementation details, provider internals, secret names, and
        production endpoints are intentionally omitted.
      </p>

      <h2>Principles</h2>
      <ul>
        <li>Authenticated identity is derived server-side from a verified session, never from a request body.</li>
        <li>Actor type is explicit: human, AI agent, worker, operator, or unauthenticated rejection path.</li>
        <li>Session state is short-lived, revocable, and scoped to current workspace membership.</li>
        <li>Protected routes fail closed when authentication, validation, audit, or capability checks are unavailable.</li>
      </ul>

      <h2>Session lifecycle</h2>
      <p>
        A successful sign-in creates a server-verifiable session that binds a
        user to an actor type and a set of live memberships. The secure-core
        boundary recomputes effective roles and capabilities from server-side
        records instead of accepting privilege claims from clients.
      </p>
      <p>
        The frontend-facing session introspection route is
        <code>GET /auth/session</code>. It returns server-derived identity,
        assurance level, live workspace memberships, role names, and
        capabilities; it accepts no request body.
      </p>
      <p>
        Session refresh, revocation, idle timeout, and disabled-user handling
        are part of the authentication boundary. Disabling a user prevents new
        privileged work and preserves historical audit and provenance rows.
      </p>

      <h2>Request handling</h2>
      <ul>
        <li>JSON bodies are validated before handlers perform side effects.</li>
        <li>Protected requests attach authenticated actor context for downstream authorization and audit writers.</li>
        <li>Missing or invalid credentials use a structured unauthenticated response without leaking workspace existence.</li>
        <li>Cross-site request protections and origin checks emit security audit events when they reject a request.</li>
      </ul>

      <h2>Non-goals</h2>
      <p>
        This page does not document concrete login endpoints, provider
        configuration, cookie names, token formats, or secret identifiers.
        Operators should use deployment runbooks for environment-specific
        setup.
      </p>
    </article>
  );
}

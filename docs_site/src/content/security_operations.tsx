export default function SecurityOperations() {
  return (
    <article className="doc-page">
      <h1>Security Operations</h1>
      <p>
        This page tracks the operational security layer that sits above the
        secure-core scaffolding. It documents what operators should monitor
        without exposing provider internals, production endpoint inventories, or
        exploit-oriented probe commands.
      </p>
      <p>
        The backend exposes the operator dashboard through
        <code>GET /operator/security-dashboard</code>. The route requires a
        valid session, step-up authentication, and a live
        <code>platform:audit_read</code> capability grant. Step-up failures
        are audited as denied permission events.
      </p>

      <h2>Admin Dashboard Signals</h2>
      <ul>
        <li>Audit, provenance, and operator chain verification status.</li>
        <li>External anchor lag for each log stream.</li>
        <li>Denied-access spikes across permission, path, CSRF, and rate-limit failures.</li>
        <li>Sandbox violations, including refused mounts, network egress, and forbidden env attempts.</li>
      </ul>

      <h2>Abuse Controls</h2>
      <p>
        Rate-limit policies are named by surface: auth, uploads, runs,
        approvals, and exports. Route wiring must use the named policy rather
        than ad-hoc numeric literals so thresholds and key scopes can be
        reviewed and audited. Account and workspace scoped policies fail closed
        if registered before their server-derived context exists.
      </p>

      <h2>Secret Operations</h2>
      <p>
        Production must use the AWS secrets provider shape with workload
        identity, an explicit provider prefix, and provider-versioned rotation
        events. Direct <code>PLASMAWORK_SECRET_*</code> variables are reserved
        for CI/test-only contexts and are rejected by production validation.
      </p>

      <h2>CI Gates</h2>
      <p>
        Pull requests run secure-core typecheck, security tests, supply-chain
        checks, SAST, dependency review, license policy review, and high
        confidence leak scanning. The default security workflow must not
        reference repository secrets.
      </p>

      <h2>Continuous Verification</h2>
      <p>
        A periodic verifier checks audit, provenance, and operator chains
        against their external anchors. Failures emit audit events and should be
        treated as incident-response inputs rather than routine test failures.
        Verifier dependency failures are reported as auditable
        <code>verifier_error</code> outcomes instead of unhandled background
        job failures.
      </p>
    </article>
  );
}

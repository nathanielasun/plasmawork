export default function SecureFrontendReadiness() {
  return (
    <article className="doc-page">
      <h1>Secure Frontend Readiness</h1>
      <p>
        This page is the UI-facing summary of
        <code>program_development/secure_frontend_readiness_plan.md</code>.
        It identifies which secure-core surfaces can be used by a
        comprehensive frontend and which must stay disabled, mocked, or
        deployment-gated.
      </p>

      <h2>Source of truth</h2>
      <ul>
        <li>
          API route readiness lives in
          <code>packages/secure_core/src/client/contracts.ts</code>.
        </li>
        <li>
          Styling rules live in <code>STYLING.md</code> and
          <code>apps/workbench-ui/src/styles.css</code>.
        </li>
        <li>
          Progress tracking lives in
          <code>program_development/secure_frontend_readiness_plan.md</code>
          and <code>program_development/timeline.md</code>.
        </li>
      </ul>

      <h2>Ready now</h2>
      <ul>
        <li>
          Workbench UI route <code>/security</code> renders the security
          operations dashboard, server-derived session, route-readiness
          contract, and disabled fail-closed controls.
        </li>
        <li>Security dashboard read path.</li>
        <li>Operator audit read and incident investigation path.</li>
        <li>Auth recovery request/consume shapes.</li>
        <li>Run creation and artifact export route metadata.</li>
      </ul>

      <h2>Disabled or blocked</h2>
      <ul>
        <li>Operator remediation remains fail-closed until real side effects are implemented.</li>
        <li>Session introspection is ready for app-shell capability gating.</li>
        <li>Worker upload is internal and deployment-gated, not a browser upload surface.</li>
        <li>Production multi-user enablement still depends on runsc, DB role, WORM, and branch-protection probes.</li>
      </ul>

      <h2>Frontend rules</h2>
      <ul>
        <li>Never infer permissions from hidden UI state; read server-derived session and capability data.</li>
        <li>Never enable a high-risk action without the backend route marked ready and approval-token flow documented.</li>
        <li>Use the existing Card, Pill, and Kpi primitives for security dashboard layouts.</li>
        <li>Label fixture fallback explicitly when secure-core is not mounted in the local UI environment.</li>
        <li>Represent fail-closed backend surfaces as disabled controls with explanatory documentation, not as active buttons.</li>
      </ul>
    </article>
  );
}

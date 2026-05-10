export default function SecurityTesting() {
  return (
    <article>
      <h1>Security Testing</h1>
      <p className="page-status">
        Security tests protect authentication, authorization, workspace
        isolation, approvals, sandboxing, audit chains, and operator access.
        This page describes guarantees, not exploit-ready commands or
        production probes.
      </p>

      <h2>Test categories</h2>
      <table>
        <thead>
          <tr><th>Category</th><th>Guarantee</th></tr>
        </thead>
        <tbody>
          <tr><td>Authentication</td><td>Invalid, expired, disabled, and unauthenticated sessions fail safely.</td></tr>
          <tr><td>Workspace isolation</td><td>Objects from one workspace cannot be read or mutated from another.</td></tr>
          <tr><td>Capabilities</td><td>Missing roles or capabilities return authorization failures and emit audit records.</td></tr>
          <tr><td>Gateway proxy map</td><td>Every state-changing proxied FastAPI route is explicitly mapped to workspace or platform capabilities; unmapped mutations fail closed.</td></tr>
          <tr><td>Approvals</td><td>High-risk actions require durable, context-bound, single-use human approval.</td></tr>
          <tr><td>Capsule versioning</td><td>Protected versions cannot be silently overwritten.</td></tr>
          <tr><td>Sandbox</td><td>Generated or imported execution remains isolated and policy-limited.</td></tr>
          <tr><td>Worker uploads</td><td>Workers cannot escape run scope or choose arbitrary storage paths.</td></tr>
          <tr><td>Audit chain</td><td>Mutation, deletion, and anchor divergence are detected.</td></tr>
          <tr><td>Operator access</td><td>Platform access is reason-bound, time-limited, and audited.</td></tr>
        </tbody>
      </table>

      <h2>CI expectations</h2>
      <p>
        The security suite is a required merge gate once secure-core code is
        active. Tests run against clean fixtures and restricted runtime roles
        where applicable. CI must not depend on production secrets.
      </p>
      <p>
        The default PR lane runs <code>scripts/test/security.sh</code> without
        deployment credentials. If a live-probe environment variable is set,
        the default script dispatches to the matching live-probe script and
        fails closed if the target runtime is not actually available. Protected
        lanes may also call these scripts directly:{" "}
        <code>security_live_db.sh</code> provisions an ephemeral PostgreSQL
        service through <code>PLASMAWORK_TEST_DB_URL</code>,{" "}
        <code>security_live_runsc.sh</code> requires
        <code>PLASMAWORK_RUNSC_PROBES=1</code> and a runner with
        <code>runsc</code> installed, and <code>security_live_worm.sh</code>
        requires <code>PLASMAWORK_ANCHOR_LIVE_PROBES=1</code> plus a dedicated
        Object-Lock probe bucket.
      </p>
      <p>
        Gateway regression tests also exercise the legacy FastAPI proxy: a
        state-changing route without a capability-map entry is refused before
        forwarding, and platform operations use server-derived platform
        capabilities rather than the active workspace's role list.
      </p>

      <h2>Documentation parity</h2>
      <ul>
        <li>Every documented security invariant needs a regression test or a named deferred test.</li>
        <li>Security tests are never disabled to make CI green.</li>
        <li>When behavior changes, the matching docs page and ADR are updated in the same workstream.</li>
      </ul>
    </article>
  );
}

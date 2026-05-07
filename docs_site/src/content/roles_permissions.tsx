export default function SecurityRolesPermissions() {
  return (
    <article>
      <h1>Security: Roles and Permissions</h1>
      <p className="page-status">
        Roles and permissions describe what an authenticated actor may do
        inside a workspace or platform administration context.
      </p>

      <h2>Capability model</h2>
      <p>
        Roles are collections of named capabilities. Authorization checks use
        the server-side role and capability store, not client-provided role
        names. Capability checks are enforced at the API boundary and again
        inside services that mutate privilege-bearing state.
      </p>

      <h2>Workspace capabilities</h2>
      <table>
        <thead>
          <tr><th>Capability family</th><th>Examples of protected actions</th></tr>
        </thead>
        <tbody>
          <tr><td>Workspace</td><td>View workspace state, manage members, change role assignments.</td></tr>
          <tr><td>Capsule</td><td>Create, read, fork, version, export, or restore capsules.</td></tr>
          <tr><td>Run</td><td>Start simulations, approve expensive work, approve HPC work, cancel runs.</td></tr>
          <tr><td>Tool and module</td><td>Register, review, promote, deprecate, or execute tools and modules.</td></tr>
          <tr><td>Approval</td><td>Request approvals or decide approvals for matching high-risk actions.</td></tr>
          <tr><td>Audit</td><td>Read audit and provenance history through the audited read path.</td></tr>
        </tbody>
      </table>

      <h2>Platform capabilities</h2>
      <p>
        Platform or operator capabilities are separate from workspace roles.
        They are time-limited, reason-bound, audited, and recorded in the
        operator event chain whenever used.
      </p>

      <h2>High-risk actions</h2>
      <p>
        High-risk actions include privilege changes, lifecycle transitions,
        sandbox policy changes, security configuration changes, and expensive
        or external compute decisions. These actions require both capability
        and a valid approval flow unless the plan explicitly marks the action
        as local-only and non-privileged.
      </p>
    </article>
  );
}

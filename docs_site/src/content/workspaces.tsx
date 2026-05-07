export default function SecurityWorkspaces() {
  return (
    <article>
      <h1>Security: Workspaces</h1>
      <p className="page-status">
        Workspaces are the multi-user isolation boundary for capsules, runs,
        tools, artifacts, approvals, quotas, and provenance records.
      </p>

      <h2>Isolation model</h2>
      <p>
        Workspaces are the primary tenant boundary. Capsules, runs, tools,
        artifacts, approvals, quotas, and provenance records are resolved
        through a workspace-scoped object reference. Clients do not supply
        storage paths, ownership fields, lifecycle status, or actor fields.
      </p>

      <h2>Access checklist</h2>
      <p>Every protected object access verifies all of the following:</p>
      <ul>
        <li>The request has an authenticated identity.</li>
        <li>The actor has live membership in the workspace.</li>
        <li>The actor has the required role or capability.</li>
        <li>The target object belongs to the workspace.</li>
        <li>The requested operation is valid for the object's lifecycle state.</li>
        <li>High-risk actions carry a valid human approval when required.</li>
        <li>Privilege-bearing mutations re-check membership and capability at commit time.</li>
      </ul>

      <h2>Storage locality</h2>
      <p>
        Derived artifacts are stored under workspace-scoped prefixes and are
        written only through server-side path builders. Workers, assisted
        workflows, and browser clients submit object references or artifacts to
        controlled upload flows; they do not choose final storage locations.
      </p>

      <h2>Failure behavior</h2>
      <ul>
        <li>Unknown workspace and unauthorized workspace access use safe, non-enumerating responses.</li>
        <li>Quota reservation failures stop writes before files are committed.</li>
        <li>Partial side effects are cleaned up when validation, quota, or sandbox checks fail.</li>
      </ul>
    </article>
  );
}

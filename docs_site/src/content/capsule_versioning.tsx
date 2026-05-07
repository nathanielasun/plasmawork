export default function SecurityCapsuleVersioning() {
  return (
    <article>
      <h1>Security: Capsule Versioning</h1>
      <p className="page-status">
        Secure-core Layer 5 documentation for protected simulation capsule
        versions.
      </p>

      <h2>Version protection</h2>
      <p>
        Capsules are scientific records. Secure-core treats published or
        reviewed capsule versions as protected objects: changes create new
        versions or forks rather than silently overwriting prior results.
      </p>

      <h2>Server-derived state</h2>
      <ul>
        <li>Current version, lifecycle state, author, reviewer, and timestamps are server-derived.</li>
        <li>Clients submit intended actions and workspace-scoped object references, not privileged state fields.</li>
        <li>Exports preserve provenance, validation evidence, audit references, and source assumptions.</li>
      </ul>

      <h2>High-risk transitions</h2>
      <p>
        Promotion, restoration, deletion-like archival, and trusted-status
        transitions require capability checks and may require approval. The
        service re-checks live membership and capability in the same
        transaction that commits the transition.
      </p>

      <h2>Agent edits</h2>
      <p>
        Generated code belongs in generated capsule areas, and user-edited
        code is not overwritten silently. Agent-produced drafts remain
        reviewable, inspectable, and tied to assumptions, units, parameters,
        and validation status.
      </p>
    </article>
  );
}

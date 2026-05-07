export default function SecurityStorage() {
  return (
    <article>
      <h1>Security: Storage</h1>
      <p className="page-status">
        Secure-core Layer 5 documentation for safe, workspace-scoped storage.
      </p>

      <h2>Storage boundary</h2>
      <p>
        The server derives all storage paths from workspace, object, and
        artifact records. Workers, agents, and browser clients submit object
        identifiers and artifact metadata; they do not provide trusted
        filesystem paths or storage prefixes.
      </p>

      <h2>Artifact rules</h2>
      <ul>
        <li>Artifacts are scoped under the owning workspace.</li>
        <li>Archive extraction validates entry names, sizes, counts, and link behavior before writing files.</li>
        <li>Quota is reserved before writes and released or committed after validation.</li>
        <li>Failed writes remove partial files and emit structured audit events.</li>
      </ul>

      <h2>Secret handling</h2>
      <p>
        Secret values are never stored in capsules, run artifacts, audit
        metadata, or generated reports. Documentation uses generic secret
        categories only; deployment-specific secret identifiers and provider
        internals belong in private operational runbooks.
      </p>

      <h2>Exports</h2>
      <p>
        Exports are explicit user actions. Exporters validate that the target
        is outside the source tree before writing, preserve provenance, and
        avoid including in-flight archives in their own output.
      </p>
    </article>
  );
}

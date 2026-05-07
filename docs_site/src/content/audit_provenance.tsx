export default function SecurityAuditProvenance() {
  return (
    <article>
      <h1>Security: Audit and Provenance</h1>
      <p className="page-status">
        Secure-core Layer 5 documentation for tamper-evident audit,
        provenance, and operator records.
      </p>

      <h2>Three event streams</h2>
      <table>
        <thead>
          <tr><th>Stream</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <tr><td>Audit</td><td>Security-relevant user, worker, API, approval, and rejection events.</td></tr>
          <tr><td>Provenance</td><td>Scientific lineage: inputs, generated outputs, assumptions, validation status, and actor attribution.</td></tr>
          <tr><td>Operator</td><td>Platform capability use, break-glass activity, incident response, and administrative access.</td></tr>
        </tbody>
      </table>

      <h2>Hash chain</h2>
      <p>
        Each stream is hash-chained with canonicalized event data and periodic
        external anchoring. Mutation, deletion, or tail truncation after an
        anchor is detectable by the verifier. Application runtime credentials
        are not allowed to update or delete committed event rows.
      </p>

      <h2>Redaction</h2>
      <p>
        Audit metadata passes through a redaction allowlist. Logs may include
        event category, workspace scope, actor type, object references, and
        rejection reason. Logs must not store raw credentials, secret values,
        provider internals, or unbounded user-provided strings.
      </p>

      <h2>Read access</h2>
      <ul>
        <li>Audit reads require an explicit audit or platform capability.</li>
        <li>Operator reads are reason-bound and session-limited.</li>
        <li>Read paths are themselves audited to preserve accountability.</li>
      </ul>
    </article>
  );
}

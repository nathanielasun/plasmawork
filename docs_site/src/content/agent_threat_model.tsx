export default function AgentThreatModel() {
  return (
    <article>
      <h1>AI and Worker Threat Model</h1>
      <p className="page-status">
        AI assistants, workers, imported tools, and generated code are treated
        as constrained actors. This page stays high level and avoids
        operational probe details.
      </p>

      <h2>Assumed adversaries</h2>
      <ul>
        <li>A curious or malicious workspace member attempting cross-workspace access.</li>
        <li>An AI assistant that follows hostile prompt content from papers, datasets, tools, or user text.</li>
        <li>Imported code that attempts unexpected file, network, or credential access.</li>
        <li>A worker whose credential or run context is replayed outside its intended scope.</li>
        <li>An operator with partial infrastructure access who must still be constrained and audited.</li>
      </ul>

      <h2>Defenses</h2>
      <ul>
        <li>Server-side identity, workspace, capability, and approval derivation.</li>
        <li>Sandboxed execution for generated code, imported tools, and workers.</li>
        <li>Workspace-scoped storage paths derived by the server.</li>
        <li>Durable audit, provenance, and operator records with tamper-evident chaining.</li>
        <li>Human approval for high-risk actions; AI assistants cannot approve their own escalation.</li>
      </ul>

      <h2>Assistant boundaries</h2>
      <p>
        Assistants may draft simulations, propose code, prepare imports, and
        request approvals. They do not become trusted identity providers, do
        not supply actor fields, do not choose privileged storage paths, and do
        not bypass review markers or lifecycle gates.
      </p>

      <h2>Residual risk</h2>
      <p>
        The workbench still depends on correct implementation of middleware,
        sandbox policy, log anchoring, and operational response. Regression
        tests and ADR-0013 make those requirements explicit so future work can
        verify them rather than relying on prose alone.
      </p>
    </article>
  );
}

export default function AgentWorkflows() {
  return (
    <article>
      <h1>Agent Workflows</h1>
      <p className="page-status">Phase 0 skeleton. Expand in Phase 4–6.</p>

      <h2>The pipeline</h2>
      <pre>
        <code>{`Paper ingestion
    ↓
Scientific interpretation report
    ↓
ModelSpec generation (validated)
    ↓
Module retrieval and gap analysis
    ↓
Experiment design
    ↓
Code generation in capsule sandbox
    ↓
Validation and review
    ↓
Promotion or rejection`}</code>
      </pre>

      <h2>Agent roles</h2>
      <table>
        <thead>
          <tr><th>Role</th><th>Responsibility</th><th>Phase enabled</th></tr>
        </thead>
        <tbody>
          <tr><td>Orchestrator</td><td>Maintains task graph, merges parallel work</td><td>6</td></tr>
          <tr><td>Repository steward</td><td>Enforces structure, docs, conventions</td><td>0</td></tr>
          <tr><td>Paper ingestion</td><td>Extracts paper content</td><td>4</td></tr>
          <tr><td>Physics interpretation</td><td>Converts paper claims to assumptions</td><td>4</td></tr>
          <tr><td>ModelSpec</td><td>Generates and validates structured spec</td><td>5</td></tr>
          <tr><td>Module retrieval</td><td>Finds reusable modules</td><td>5</td></tr>
          <tr><td>Code generation</td><td>Writes candidate implementation</td><td>6</td></tr>
          <tr><td>Numerical methods</td><td>Reviews solver / stability</td><td>6</td></tr>
          <tr><td>Backend optimization</td><td>Chooses execution backend</td><td>8</td></tr>
          <tr><td>Validation</td><td>Creates and runs validation tests</td><td>6</td></tr>
          <tr><td>Visualization</td><td>Builds plots and panels</td><td>6</td></tr>
          <tr><td>Documentation</td><td>Updates docs, README, guides</td><td>1</td></tr>
          <tr><td>Bug memory</td><td>Checks <code>bugs_and_fixes/</code> before edits</td><td>1</td></tr>
          <tr><td>Security / sandbox</td><td>Prevents unsafe file or execution behavior</td><td>4</td></tr>
          <tr><td>Release</td><td>Packages stable builds and examples</td><td>7</td></tr>
        </tbody>
      </table>

      <h2>Audit gates</h2>
      <p>The following actions always require explicit user approval, regardless of agent role:</p>
      <ul>
        <li>Promotion of a module to <code>trusted</code></li>
        <li>External file export</li>
        <li>Destructive edits</li>
        <li>High-compute runs</li>
        <li>Destructive git operations</li>
      </ul>

      <h2>What agents must not do</h2>
      <ul>
        <li>Write outside <code>local_cache/</code>, <code>temp_imports/</code>, <code>temp_runs/</code>, <code>simulation_capsules/</code>.</li>
        <li>Overwrite <code>&lt;capsule&gt;/src/user_edits/</code>.</li>
        <li>Silently fabricate physical coefficients.</li>
        <li>Promote modules to <code>trusted</code> without human review.</li>
        <li>Hide assumptions behind opaque generated code.</li>
      </ul>

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>Walkthrough of the full pipeline against a real paper.</li>
        <li>Agent trace format and how to inspect it.</li>
        <li>Approval-gate UI flows.</li>
      </ul>
    </article>
  );
}

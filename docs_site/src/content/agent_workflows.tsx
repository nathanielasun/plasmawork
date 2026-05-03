export default function AgentWorkflows() {
  return (
    <article>
      <h1>Agent Workflows</h1>
      <p className="page-status">
        Phase 4 (paper ingestion) implemented. Phases 5–6 expand into
        ModelSpec generation and sandboxed code generation.
      </p>

      <h2>Phase 4 — paper ingestion</h2>
      <p>
        Imports a paper file (Markdown today; PDF support is a Phase 4+
        extension) into a capsule's <code>paper_sources/</code> and runs
        three deterministic extractors plus a template interpretation
        agent. Every artifact is explicitly marked <em>needs human
        review</em>; edits go through{" "}
        <code>POST /api/papers/&lt;capsule&gt;/edit</code> and append to{" "}
        <code>provenance/agent_trace.md</code>.
      </p>

      <h3>Outputs (under <code>paper_sources/</code>)</h3>
      <ul>
        <li><code>extracted_equations.json</code> — equations with
        confidence + source line numbers.</li>
        <li><code>extracted_parameters.yaml</code> — parameters with
        units, flagging <code>missing_units</code> rows that need a human
        reviewer (plan §22 — never fabricate units).</li>
        <li><code>paper_summary.md</code>, <code>assumptions.md</code>,{" "}
        <code>validity_domain.md</code>, <code>implementation_plan.md</code>{" "}
        — agent-generated interpretation drafts. Plan §Phase 4 forbids
        treating these as trusted; Phase 5's ModelSpec generation only
        consumes them after a human reviewer has approved.</li>
      </ul>

      <h3>Try it</h3>
      <pre>
        <code>{`# Library
from simworkbench.ingestion import PaperImporter
PaperImporter().ingest("paper.md", "simulation_capsules/foo.lxp")

# UI
# Open the workbench UI's "Papers" tab. Pick a capsule, paste a paper
# path, click Import. Edit equations/parameters inline; every edit lands
# in provenance/agent_trace.md.`}</code>
      </pre>

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

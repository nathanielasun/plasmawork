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
        Imports a paper file (Markdown <em>and PDF</em>; PDF text
        extraction uses <code>pypdf</code>, a hard dependency of
        <code>simworkbench</code>) into a capsule's{" "}
        <code>paper_sources/</code> and runs five deterministic
        extractors plus a template interpretation agent. Every artifact
        is explicitly marked <em>needs human review</em>; edits go
        through <code>POST /api/papers/&lt;capsule&gt;/edit</code> and
        append to <code>provenance/agent_trace.md</code>.
      </p>

      <h3>Outputs (under <code>paper_sources/</code>)</h3>
      <ul>
        <li><code>&lt;source&gt;.md</code> or <code>&lt;source&gt;.pdf</code>
        {" "}— the paper file copied verbatim (plan §4A "Preserve source
        files").</li>
        <li><code>extracted_text.md</code> — plain-text body of the
        paper. Identity for Markdown sources; <code>pypdf</code>-extracted
        text for PDFs (page count recorded in the ingestion artifacts).</li>
        <li><code>extracted_tables.json</code> — Markdown pipe-tables
        with headers + rows + source line numbers.</li>
        <li><code>extracted_figures.json</code> — figure metadata
        (alt text + path + nearby caption).</li>
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

      <h2>Phase 10 — autonomy</h2>
      <p>
        Phase 10 ships the <code>simworkbench.autonomy</code> module:
        an autonomous experiment-design loop with hard budget caps and
        single-use approval tokens. The four autonomy surfaces are
        data-emitting (the user reviews the output before any
        privileged action runs):
      </p>
      <ul>
        <li>
          <code>ExperimentDesigner.design(spec)</code> → an
          <code>ExperimentPlan</code> with minimum viable model, ordered
          fidelity ladder, cost estimate, planned diagnostics, and
          validation path. Refuses if no recommended solver is declared.
        </li>
        <li>
          <code>SmokeRunner.run(experiment)</code> → a
          <code>SmokeReport</code> with diagnostics interpretation,
          instability flags, and suggested parameter adjustments. The
          agent NEVER auto-applies adjustments; the user reviews.
        </li>
        <li>
          <code>ControlledSweepAgent(budget=N)</code> wraps the Phase-9
          <code>SweepEngine</code> with a hard budget cap, monitors
          run-by-run, summarises trends, and recommends the next bounded
          sweep. The agent constructor and <code>launch</code> expose
          NO bypass kwargs.
        </li>
        <li>
          <code>ScientificReviewer.write(capsule)</code> writes
          <code>{"<capsule>"}/review/scientific_review.md</code> with
          assumption critique, missing physics, literature alignment,
          overclaim flags, and recommended validation. Off-limits
          subtrees (<code>src/user_edits/</code>,
          <code>paper_sources/</code>, <code>provenance/</code>) are
          explicitly refused.
        </li>
      </ul>
      <p>
        Plan §22 (Scientific Accuracy Policy) is enforced by
        <code>capsule_status_for_plan(plan)</code> — any placeholder
        coefficient pins the capsule to <code>exploratory</code>; only
        a human reviewer can graduate it to <code>validated</code>.
        Approval tokens for trusted-promotion / expensive-runs /
        external-export / destructive-edits live as files under
        <code>local_cache/autonomy_approvals/</code>; the HTTP API
        never reads <code>actor</code> or <code>role</code> from the
        request body. See ADR-0007 for the full budget-governance
        contract.
      </p>

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>Walkthrough of the full pipeline against a real paper.</li>
        <li>Agent trace format and how to inspect it.</li>
        <li>Approval-gate UI flows.</li>
      </ul>
    </article>
  );
}

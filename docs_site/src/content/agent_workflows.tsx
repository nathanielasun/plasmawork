export default function AgentWorkflows() {
  return (
    <article>
      <h1>Automation and Review Workflows</h1>
      <p className="page-status">
        Assisted workflows cover paper ingestion, interpretation drafting,
        candidate code generation, and review summaries. They do not replace
        human review, validation, or approval gates for privileged actions.
      </p>

      <h2>Paper ingestion</h2>
      <p>
        Imports a paper file (Markdown <em>and PDF</em>; PDF text
        extraction uses <code>pypdf</code>, a hard dependency of
        <code>simworkbench</code>) into a capsule's{" "}
        <code>paper_sources/</code> and runs five deterministic
        extractors plus a template interpretation draft. Every artifact
        is explicitly marked <em>needs human review</em>; edits go
        through <code>POST /api/papers/&lt;capsule&gt;/edit</code> and
        append to <code>provenance/agent_trace.md</code>.
      </p>

      <h3>Outputs (under <code>paper_sources/</code>)</h3>
      <ul>
        <li><code>&lt;source&gt;.md</code> or <code>&lt;source&gt;.pdf</code>
        {" "}— the paper file copied verbatim.</li>
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
        reviewer. Missing units are surfaced; they are not fabricated.</li>
        <li><code>paper_summary.md</code>, <code>assumptions.md</code>,{" "}
        <code>validity_domain.md</code>, <code>implementation_plan.md</code>{" "}
        — assisted interpretation drafts. Treat these as review inputs, not
        trusted scientific facts.</li>
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

      <h2>Automation roles</h2>
      <table>
        <thead>
          <tr><th>Role</th><th>Responsibility</th><th>Primary surface</th></tr>
        </thead>
        <tbody>
          <tr><td>Orchestrator</td><td>Maintains task graph and merges parallel work</td><td>Assisted workflow runner</td></tr>
          <tr><td>Paper ingestion</td><td>Extracts paper content</td><td>Papers and capsule source pages</td></tr>
          <tr><td>Physics interpretation</td><td>Converts paper claims to assumptions for review</td><td>ModelSpec drafting</td></tr>
          <tr><td>Module retrieval</td><td>Finds reusable modules and reports gaps</td><td>Module registry</td></tr>
          <tr><td>Code generation</td><td>Writes candidate implementation in generated areas</td><td>Capsule code panel</td></tr>
          <tr><td>Numerical methods</td><td>Reviews solver choice and stability risks</td><td>Validation panel</td></tr>
          <tr><td>Backend optimization</td><td>Chooses execution backend within policy</td><td>Run configuration</td></tr>
          <tr><td>Visualization</td><td>Builds plots and panels</td><td>Diagnostics panel</td></tr>
          <tr><td>Documentation</td><td>Updates docs, README, and guides after behavior changes</td><td>Documentation browser</td></tr>
          <tr><td>Security / sandbox</td><td>Prevents unsafe file or execution behavior</td><td>Security operations</td></tr>
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

      <h2>What automation must not do</h2>
      <ul>
        <li>Write outside <code>local_cache/</code>, <code>temp_imports/</code>, <code>temp_runs/</code>, <code>simulation_capsules/</code>.</li>
        <li>Overwrite <code>&lt;capsule&gt;/src/user_edits/</code>.</li>
        <li>Silently fabricate physical coefficients.</li>
        <li>Promote modules to <code>trusted</code> without human review.</li>
        <li>Hide assumptions behind opaque generated code.</li>
      </ul>

      <h2>Autonomous experiment assistance</h2>
      <p>
        The <code>simworkbench.autonomy</code> module provides an autonomous
        experiment-design loop with hard budget caps and
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
          assistant never auto-applies adjustments; the user reviews.
        </li>
        <li>
          <code>ControlledSweepAgent(budget=N)</code> wraps the Phase-9
          <code>SweepEngine</code> with a hard budget cap, monitors
          run-by-run, summarises trends, and recommends the next bounded
          sweep. The constructor and <code>launch</code> expose no budget
          bypass arguments.
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
        Scientific accuracy policy is enforced by
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

      <h2>Still missing from this guide</h2>
      <ul>
        <li>Walkthrough of the full pipeline against a real paper.</li>
        <li>Automation trace format and how to inspect it.</li>
        <li>Approval-gate UI flows.</li>
      </ul>
    </article>
  );
}

export default function CurrentContracts() {
  return (
    <article>
      <h1>Current Contracts and Documentation Hygiene</h1>
      <p className="page-status">
        This page explains how to separate current operating guidance from
        historical provenance, and how to keep agent-facing documents concise
        enough for fast model lookup.
      </p>

      <h2>Current contract zones</h2>
      <p>
        These files describe how the workbench behaves now. They must use
        present-state language and match real command/API behavior:
      </p>

      <h2>Approved policy components</h2>
      <ol>
        <li><strong>A:</strong> preserve historical provenance zones as history.</li>
        <li><strong>B:</strong> keep current contract zones present-tense and behavior-accurate.</li>
        <li><strong>C:</strong> use the focused scanner for current contract language.</li>
        <li><strong>D:</strong> wire the scanner into repository gates.</li>
        <li><strong>E:</strong> keep this documentation page current after major updates.</li>
        <li><strong>F:</strong> keep agent rules aligned with the scanner and current-zone policy.</li>
        <li><strong>G:</strong> use dated errata for high-risk historical drift instead of rewriting history.</li>
        <li><strong>H:</strong> include current-surface checks in Definition of Done.</li>
        <li><strong>I:</strong> control agent context size by keeping manuals concise, canonical, and searchable.</li>
      </ol>
      <ul>
        <li><code>README.md</code>, <code>LIMITATIONS.md</code>, <code>AGENTS.md</code>, and <code>CLAUDE.md</code></li>
        <li><code>docs_site/src/content/</code> pages shown in the UI</li>
        <li>UI copy under <code>apps/workbench-ui/src/</code></li>
        <li>Script usage/help/output under <code>scripts/</code></li>
        <li>Runtime exception messages and current metadata under <code>packages/</code></li>
      </ul>

      <h2>Historical provenance zones</h2>
      <p>
        These files may preserve older wording because they are the audit trail
        of how the repository reached its current state:
      </p>
      <ul>
        <li><code>program_development/timeline.md</code></li>
        <li><code>program_development/milestones/</code></li>
        <li><code>program_development/architectural_decisions/</code></li>
        <li><code>bugs_and_fixes/bugfixes.md</code></li>
        <li><code>bugs_and_fixes/agent_error_patterns.md</code></li>
      </ul>
      <p>
        Do not rewrite historical records just to make them sound current. If a
        historical statement could cause a high-risk misunderstanding, append a
        dated errata note instead.
      </p>

      <h2>Status words</h2>
      <table>
        <thead>
          <tr><th>Term</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr><td>Real</td><td>Implemented and locally usable for the stated scope.</td></tr>
          <tr><td>Validated</td><td>Backed by tests or benchmarks for the stated scientific/regression scope.</td></tr>
          <tr><td>Candidate</td><td>Shape or interface exists, but it is not trusted for scientific use.</td></tr>
          <tr><td>Deployment-gated</td><td>Implementation exists, but needs target-runtime credentials, services, or live probes.</td></tr>
          <tr><td>Unsupported by this backend</td><td>The current backend cannot perform the operation; choose another backend/module.</td></tr>
          <tr><td>Historical</td><td>Preserved record, not current operating guidance.</td></tr>
        </tbody>
      </table>

      <h2>Scanner</h2>
      <p>
        Run <code>scripts/dev/check_current_contract_language.py</code> before
        major closes or documentation rewrites. It scans current contract zones
        and ignores provenance zones. The default repository convention checker
        also runs this scanner.
      </p>

      <h2>Context hygiene for agent manuals</h2>
      <p>
        Large agent documents should be structured for grep-first lookup. Use a
        canonical owner for each rule instead of copying full policy blocks
        across multiple files.
      </p>
      <ul>
        <li><code>AGENTS.md</code> owns durable cross-agent rules and Definition of Done.</li>
        <li><code>CLAUDE.md</code> owns operational commands and links back to AGENTS for policy.</li>
        <li><code>LIMITATIONS.md</code> owns current user-facing capability truth.</li>
        <li><code>bugs_and_fixes/agent_error_patterns.md</code> owns reusable failure patterns.</li>
        <li><code>bugs_and_fixes/bugfixes.md</code> owns dated incident autopsies.</li>
      </ul>
      <p>
        When adding durable rules, include stable lookup tags such as{" "}
        <code>DOC-CURRENT-CONTRACT</code>, <code>DOC-DOD</code>,{" "}
        <code>DOC-PHASE-GATE</code>, <code>DOC-SECURITY</code>, or{" "}
        <code>DOC-CONTEXT-HYGIENE</code> near the relevant heading. A future
        agent should be able to locate the right rule with one search.
      </p>
    </article>
  );
}

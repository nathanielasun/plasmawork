export default function Troubleshooting() {
  return (
    <article>
      <h1>Troubleshooting</h1>
      <p className="page-status">
        Phase 0 skeleton. Real entries are added when real bugs are encountered.
      </p>

      <h2>Where to look first</h2>
      <ol>
        <li>
          <code>bugs_and_fixes/bugfixes.md</code> — resolved bugs, with root
          cause and the regression test that protects against them.
        </li>
        <li>
          <code>bugs_and_fixes/known_failures.md</code> — open / unresolved
          limitations and their workarounds.
        </li>
        <li>
          <code>bugs_and_fixes/agent_error_patterns.md</code> — recurring
          agent mistakes and how to detect them.
        </li>
        <li>
          <code>program.log</code> — runtime log (gitignored). The format is
          documented in <code>bugs_and_fixes/program.log.example</code>.
        </li>
      </ol>

      <h2>Common questions (placeholders)</h2>

      <h3>The convention checker fails</h3>
      <p>
        Run <code>./scripts/dev/check_repo_conventions.sh</code> with
        <code>--verbose</code>. It prints which rule failed and which file it
        expected. Fix the underlying issue rather than suppressing the check.
      </p>

      <h3>A documented script is missing</h3>
      <p>
        That is a Phase 0 convention failure. The README may document planned
        commands before the subsystem exists, but the command path itself must
        exist and either dispatch to the implementation or print the phase
        where implementation is scheduled.
      </p>

      <h3>A simulation runs but produces nonsense</h3>
      <p>
        Check the validation panel. If status is <code>exploratory</code> or
        <code>unvalidated</code>, treat the result as a placeholder. Inspect
        the gap analysis report for missing coefficient sources, and the
        ModelSpec for unit mismatches.
      </p>

      <h3>An agent overwrote my edits</h3>
      <p>
        This must not happen. Agents write only to{" "}
        <code>&lt;capsule&gt;/src/generated/</code>. If you find changes in{" "}
        <code>&lt;capsule&gt;/src/user_edits/</code> attributable to an agent,
        log it as an entry in <code>agent_error_patterns.md</code> and file a
        bug. The provenance trace at{" "}
        <code>&lt;capsule&gt;/provenance/agent_trace.md</code> identifies the
        responsible agent run.
      </p>

      <h3>I get permission errors writing to /tmp</h3>
      <p>
        The workbench is not supposed to write to <code>/tmp</code>. All temp
        files go under <code>local_cache/</code>, <code>temp_imports/</code>,
        <code>temp_runs/</code>, or <code>simulation_capsules/</code>. If you
        see <code>/tmp</code> writes in a stack trace, that is a bug — capture
        it in <code>bugs_and_fixes/bugfixes.md</code>.
      </p>

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>Real diagnostic flowcharts for the most common failure modes.</li>
        <li>Backend-specific troubleshooting (CUDA, MPI, external PIC).</li>
        <li>How to read the agent trace and the provenance lock.</li>
      </ul>
    </article>
  );
}

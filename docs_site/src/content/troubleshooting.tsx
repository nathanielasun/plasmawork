export default function Troubleshooting() {
  return (
    <article>
      <h1>Troubleshooting</h1>
      <p className="page-status">
        Use this page to decide whether a problem is a local setup issue, a
        validation failure, a security/permission rejection, or a known bug
        with an existing regression note.
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
          automation and development mistakes and how to detect them.
        </li>
        <li>
          <code>program.log</code> — runtime log (gitignored). The format is
          documented in <code>bugs_and_fixes/program.log.example</code>.
        </li>
      </ol>

      <h2>Common questions</h2>

      <h3>The convention checker fails</h3>
      <p>
        The default <code>./scripts/dev/check_repo_conventions.sh</code> command
        is the hard repository gate and should pass. Run it with{" "}
        <code>--verbose</code> to see the failed invariant and fix the
        underlying issue rather than suppressing the check.
      </p>
      <p>
        If you intentionally ran{" "}
        <code>./scripts/dev/check_repo_conventions.sh --include-open-workstreams</code>,
        failures may be the active workstream TODO backlog. Those failures are
        expected until the named workstream entities land, and they are kept
        separate from the normal test runner.
      </p>

      <h3>A documented script is missing</h3>
      <p>
        That is a convention failure. The README may document planned
        commands before the subsystem exists, but the command path itself must
        exist and either dispatch to the implementation or explain why the
        command is unavailable.
      </p>

      <h3>A command behaves like an old phase stub</h3>
      <p>
        Treat that as a contract-drift bug, even when the convention checker
        passes. Verify the documented command against the current code path,
        update stale phase wording, add a regression test for the real
        behavior, and record the fix in <code>bugs_and_fixes/</code>. A script
        that cannot safely run in the current environment must fail closed, not
        exit successfully after printing a placeholder message.
      </p>

      <h3>A simulation runs but produces nonsense</h3>
      <p>
        Check the validation panel. If status is <code>exploratory</code> or
        <code>unvalidated</code>, treat the result as a placeholder. Inspect
        the gap analysis report for missing coefficient sources, and the
        ModelSpec for unit mismatches.
      </p>

      <h3>Automation overwrote my edits</h3>
      <p>
        This must not happen. Generated changes belong in{" "}
        <code>&lt;capsule&gt;/src/generated/</code>. If you find changes in{" "}
        <code>&lt;capsule&gt;/src/user_edits/</code> attributable to an
        assisted workflow, log it as an entry in
        <code>agent_error_patterns.md</code> and file a bug. The provenance
        trace at <code>&lt;capsule&gt;/provenance/agent_trace.md</code>
        identifies the responsible run.
      </p>

      <h3>I get permission errors writing to /tmp</h3>
      <p>
        The workbench is not supposed to write to <code>/tmp</code>. All temp
        files go under <code>local_cache/</code>, <code>temp_imports/</code>,
        <code>temp_runs/</code>, or <code>simulation_capsules/</code>. If you
        see <code>/tmp</code> writes in a stack trace, that is a bug — capture
        it in <code>bugs_and_fixes/bugfixes.md</code>.
      </p>

      <h2>Still missing from this guide</h2>
      <ul>
        <li>Real diagnostic flowcharts for the most common failure modes.</li>
        <li>Backend-specific troubleshooting (CUDA, MPI, external PIC).</li>
        <li>How to read the automation trace and the provenance lock.</li>
      </ul>
    </article>
  );
}

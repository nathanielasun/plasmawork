export default function Sandboxing() {
  return (
    <article>
      <h1>Sandboxing</h1>
      <p className="page-status">
        Sandboxing defines the user-facing execution guarantees for generated
        code, imported tools, workers, and trusted tools. ADR-0009 records the
        runtime decision.
      </p>

      <h2>Sandbox guarantee</h2>
      <p>
        Generated code, imported tools, workers, and trusted tools execute
        inside a controlled sandbox. Trust can widen allowed resources within
        policy, but trust never grants execution outside the sandbox.
      </p>

      <h2>Controls</h2>
      <ul>
        <li>Per-run CPU, memory, process, wall-time, and disk limits.</li>
        <li>No direct access to host files, other workspaces, database credentials, or deployment secrets.</li>
        <li>Network egress is denied by default and mediated through an allowlisted broker when required.</li>
        <li>Sandbox violations emit audit events and fail the run closed.</li>
        <li>Worker outputs are returned through the controlled artifact-upload path.</li>
      </ul>

      <h2>Scientific workflow impact</h2>
      <p>
        Sandbox policy may cause a run to fail before producing scientific
        output. That failure is preferable to silently running with unsafe
        access. Users should treat sandbox failures as execution-policy
        findings, not physics validation failures.
      </p>

      <h2>Trusted tools</h2>
      <p>
        Trusted tools still run in the sandbox. Promotion can add reviewed
        capabilities, quota, or allowlist entries, but cannot bypass isolation,
        audit, or workspace scoping.
      </p>

      <h2>Tool-draft preview</h2>
      <p>
        Draft preview is a code-execution path, so production posture treats it
        as sandbox-dependent. In local single-user development, preview may run
        through the bounded dev harness with fixed timeout and output caps. In
        gateway-required mode, the endpoint refuses preview unless a configured
        sandbox launcher or <code>runsc</code> runtime is available. A boolean
        environment variable is not accepted as evidence of isolation.
      </p>
    </article>
  );
}

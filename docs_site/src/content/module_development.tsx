export default function ModuleDevelopment() {
  return (
    <article>
      <h1>Module Development</h1>
      <p className="page-status">Phase 0 skeleton. Expand in Phase 7.</p>

      <h2>Where modules live</h2>
      <pre>
        <code>{`packages/physics_modules/<domain>/<name>/
  module.yaml
  README.md
  equations.md
  assumptions.md
  validity_domain.md
  src/
  tests/
  benchmarks/
  docs/
  examples/
  changelog.md`}</code>
      </pre>

      <h2>Module lifecycle</h2>
      <pre>
        <code>{`draft → candidate → validated → trusted → deprecated`}</code>
      </pre>
      <p>
        Agents may create <code>draft</code> and <code>candidate</code>.
        Promotion to <code>validated</code> requires the criteria below.
        Promotion to <code>trusted</code> additionally requires a human
        reviewer.
      </p>

      <h2>Promotion criteria for <code>validated</code></h2>
      <ol>
        <li>Unit tests pass.</li>
        <li>Documentation exists (purpose, inputs, outputs, units, examples, validity domain).</li>
        <li>Inputs and outputs are unit-specified.</li>
        <li>Validity domain is explicit.</li>
        <li>At least one benchmark or limiting-case validation exists.</li>
        <li>Known limitations are documented.</li>
        <li>Bug history has been checked (<code>bugs_and_fixes/</code>).</li>
        <li>Regression tests exist for any prior failures.</li>
      </ol>

      <h2>Adding a module</h2>
      <ol>
        <li>Copy the closest template from <code>packages/physics_modules/templates/</code> into the new path.</li>
        <li>Edit <code>module.yaml</code>: name, version, domain, status (<code>candidate</code>), I/O with units, validity domain, references.</li>
        <li>Implement <code>src/</code>. Public functions take and return unit-aware quantities — no raw floats at the boundary.</li>
        <li>Add <code>tests/</code>: at minimum a unit test for the I/O contract and a validation test for a limiting / analytical case.</li>
        <li>Add documentation: <code>README.md</code>, <code>assumptions.md</code>, <code>validity_domain.md</code>, <code>equations.md</code>, <code>changelog.md</code>, <code>examples/</code>.</li>
        <li>Register: <code>./scripts/dev/refresh_registry.sh</code>.</li>
        <li>Run validation: <code>./scripts/test/validation.sh</code>.</li>
      </ol>

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>End-to-end walkthrough of authoring a new rate-equation module.</li>
        <li>Reference for the module YAML schema.</li>
        <li>Per-domain conventions (laser, plasma, MD, etc.).</li>
      </ul>
    </article>
  );
}

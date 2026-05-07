export default function ModuleDevelopment() {
  return (
    <article>
      <h1>Module Development</h1>
      <p className="page-status">
        Physics modules are reusable scientific components. Each module must
        declare units, validity limits, tests, benchmarks, dependencies, and
        backend compatibility before it can be trusted by default.
      </p>

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
        New or assisted modules start as <code>draft</code> or
        <code>candidate</code>. Promotion to <code>validated</code> requires
        the criteria below, a
        passing declared test run, and a single-use human approval token.
        Local reviewers create that token with
        <code>python -m simworkbench.modules.approve</code>; the registry
        consumes it inside <code>ModuleRegistry.set_status</code> before
        rewriting <code>module.yaml</code>.
        Promotion to <code>trusted</code> additionally requires reviewer
        approval and repeated validation evidence.
      </p>

      <h2>Promotion criteria for <code>validated</code></h2>
      <ol>
        <li>Unit tests pass.</li>
        <li>Documentation exists (purpose, inputs, outputs, units, examples, validity domain).</li>
        <li>Inputs and outputs are unit-specified.</li>
        <li>Validity domain is explicit.</li>
        <li>At least one benchmark or limiting-case validation exists and is listed in <code>module.yaml</code>.</li>
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
        <li>Run validation: <code>./scripts/test/validation.sh</code> and the module-local tests.</li>
      </ol>
    </article>
  );
}

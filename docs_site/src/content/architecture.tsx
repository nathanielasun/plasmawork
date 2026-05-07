export default function Architecture() {
  return (
    <article>
      <h1>Architecture</h1>
      <p className="page-status">
        The workbench is split into a Python simulation/runtime layer, a
        TypeScript UI and documentation layer, secure multi-user scaffolding,
        and capsule-oriented storage boundaries.
      </p>

      <h2>System layout</h2>
      <pre>
        <code>{`apps/workbench-ui/        TypeScript UI shell
docs_site/                TypeScript/MDX documentation
packages/
  core/                   ModelSpec, runtime, registry, units, validation
  agent_orchestration/    paper ingestion, code generation, review automation
  physics_modules/        laser, plasma, species, MD, phase_transition, PDE, MC
  solver_backends/        python_cpu, numba_cpu, cpp, fortran, cuda, kokkos, petsc, amrex, external_pic
  visualization/          plotters, viewers, dashboards, exporters
  internal_tools/         SDK, registry, examples, templates`}</code>
      </pre>
      <p>
        Package manifests and command wrappers are intentionally present even
        for surfaces that are deployment-gated. Documentation should point at
        real entrypoints, and an unavailable command should fail with a clear
        message rather than a missing path.
      </p>
      <p>
        The core experiment model is built around <code>ModelSpec</code>,
        <code>Experiment</code>, <code>RunConfig</code>,
        <code>BackendConfig</code>, <code>DiagnosticConfig</code>, unit-aware
        boundaries, and explicit serialization.
      </p>

      <h2>Dependency direction</h2>
      <p>
        <code>physics_modules → core</code>,
        {" "}<code>solver_backends → core</code>,
        {" "}<code>agent_orchestration → core</code>,
        {" "}<code>visualization → core</code>,
        {" "}<code>apps/workbench-ui → core (via API)</code>.
        {" "}<code>docs_site</code> is standalone.
      </p>
      <p>No package imports its parent; cross-package coupling goes through documented APIs or registries.</p>

      <h2>Process boundaries</h2>
      <ul>
        <li>Python core runs as a backend service exposing a documented HTTP/IPC API in <code>packages/core/src/simworkbench/api/</code>.</li>
        <li>The TypeScript UI calls into the API. The two never link directly.</li>
        <li>Long-running simulations may be spawned as child processes, container processes, or HPC jobs depending on the backend.</li>
      </ul>

      <h2>Key concepts</h2>
      <ul>
        <li><strong>ModelSpec</strong> — structured intermediate representation between papers and code (see ADR-0003).</li>
        <li><strong>Simulation Capsule</strong> — portable experiment bundle (see <code>simulation-capsules</code> page and ADR-0002).</li>
        <li><strong>Module Registry</strong> — physics modules and internal tools with status lifecycle.</li>
        <li><strong>Validation</strong> — every simulation and module carries a validation status label.</li>
      </ul>

      <h2>Operational reading order</h2>
      <ul>
        <li>Read <strong>Simulation Capsules</strong> for durable run storage and export behavior.</li>
        <li>Read <strong>Validation</strong> before trusting numerical output.</li>
        <li>Read <strong>Security and Operations</strong> pages before enabling multi-user deployment features.</li>
      </ul>
    </article>
  );
}

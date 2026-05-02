export default function Architecture() {
  return (
    <article>
      <h1>Architecture</h1>
      <p className="page-status">Phase 0 skeleton. Expand in Phase 1–2.</p>

      <h2>System layout</h2>
      <pre>
        <code>{`apps/workbench-ui/        TypeScript UI shell
docs_site/                TypeScript/MDX documentation
packages/
  core/                   ModelSpec, runtime, registry, units, validation
  agent_orchestration/    paper ingestion, codegen, review agents (Phase 4+)
  physics_modules/        laser, plasma, species, MD, phase_transition, PDE, MC
  solver_backends/        python_cpu, numba_cpu, cpp, fortran, cuda, kokkos, petsc, amrex, external_pic
  visualization/          plotters, viewers, dashboards, exporters
  internal_tools/         SDK, registry, examples, templates`}</code>
      </pre>

      <h2>Dependency direction</h2>
      <p>
        <code>physics_modules → core</code>,
        {" "}<code>solver_backends → core</code>,
        {" "}<code>agent_orchestration → core</code>,
        {" "}<code>visualization → core</code>,
        {" "}<code>apps/workbench-ui → core (via API)</code>.
        {" "}<code>docs_site</code> is standalone.
      </p>
      <p>No package imports its parent — circular imports across phase boundaries are forbidden.</p>

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

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>Sequence diagrams for: paper import → ModelSpec → run → capsule.</li>
        <li>Backend selection logic and the policy in <code>configs/backends.yaml</code>.</li>
        <li>Provenance flow and what is captured at each step.</li>
      </ul>
    </article>
  );
}

export default function SimulationCapsules() {
  return (
    <article>
      <h1>Simulation Capsules</h1>
      <p className="page-status">
        Phase 2 finalized: <code>v0.1</code> manifest schema, HDF5 bulk data,
        export + fork system, and a six-tab inspection UI.
      </p>

      <h2>What a capsule is</h2>
      <p>
        A simulation capsule is a portable, reproducible bundle of a single
        experiment. It carries the model, code, configs, data, results,
        validation evidence, and provenance. The directory form is canonical;
        an archive form (<code>.lxp.zip</code>) is for transport.
      </p>

      <h2>Capsule layout (<code>v0.1</code>)</h2>
      <p>
        Every capsule's <code>manifest.toml</code> declares
        {" "}<code>capsule.format_version = "v0.1"</code>. The validator
        rejects manifests whose schema version is anything else; migrations
        live under <code>simworkbench.serialization.migrations</code>.
      </p>
      <pre>
        <code>{`<name>.lxp/
  manifest.toml             # v0.1 — see CapsuleSection schema
  paper_sources/
    source.pdf
    extracted_text.md
    extracted_equations.json
    extracted_parameters.yaml
  model/
    model_spec.yaml
    assumptions.md
    validity_domain.md
    units_report.md
  src/
    generated/        ← agent writes here
    user_edits/       ← user edits only — agents must not overwrite
    kernels/
  configs/
    run_config.yaml
    backend_config.yaml
    visualization_config.yaml
  data/
    initial_conditions.h5
    cached_coefficients.zarr
  results/
    diagnostics.h5      ← canonical (Phase 2A); diagnostics.json kept for legacy capsules
    plots/
    checkpoints/
  validation/
    dimensional_checks.json
    conservation_checks.json
    benchmark_results.json
    convergence_results.json
  notebooks/
    analysis.ipynb
  provenance/
    provenance.lock
    environment.yaml
    agent_trace.md
  README.md`}</code>
      </pre>

      <h2>What capsules support (Phase 2)</h2>
      <ul>
        <li>Save</li>
        <li>Load</li>
        <li>Fork (copies every subtree except <code>provenance/</code>; new
        provenance records the parent's source-aggregate hash)</li>
        <li>Export code (<code>src/{"{generated,user_edits,kernels}"}/</code>)</li>
        <li>Export data (<code>data/</code> + <code>results/</code>)</li>
        <li>Export plots (re-renders from diagnostics)</li>
        <li>Export notebook (<code>analysis.ipynb</code>)</li>
        <li>Export report (Markdown summary)</li>
        <li>Export archive (<code>.lxp.zip</code>)</li>
        <li>Inspect manifest, ModelSpec, code, results, validation, provenance — six-tab UI</li>
      </ul>

      <h2>Capsule lifecycle</h2>
      <ul>
        <li>In-flight runs live in <code>temp_runs/&lt;run_id&gt;/</code>.</li>
        <li>Promotion to a capsule moves the directory to <code>simulation_capsules/&lt;name&gt;.lxp/</code>.</li>
        <li>Forking creates a new capsule that records the parent's source-aggregate hash in <code>provenance.lock</code> as <code>parent_capsule_hash</code>.</li>
        <li><code>provenance/</code> is append-only after creation. The agent_trace writer refuses overwrites and refuses any action targeting <code>src/user_edits/</code>.</li>
      </ul>

      <h2>Bulk-data choice</h2>
      <p>
        ADR-0002 selects <strong>HDF5</strong> (<code>h5py</code>) for capsule
        bulk data. Zarr is deferred to Phase 8 if HPC parallel-write parity
        becomes the constraint. Phase 1's minimal capsule wrote
        <code>diagnostics.json</code>; Phase 2A writes
        <code>diagnostics.h5</code> and the inspection API accepts both.
      </p>

      <h2>Migrations</h2>
      <p>
        Migrations between schema versions live in
        <code>simworkbench.serialization.migrations</code>. The v0.1 →
        v0.1 step is the identity migration; future versions are added by
        registering a new step from the registry.
      </p>
    </article>
  );
}

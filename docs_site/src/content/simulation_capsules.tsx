export default function SimulationCapsules() {
  return (
    <article>
      <h1>Simulation Capsules</h1>
      <p className="page-status">Phase 0 skeleton. Expand in Phase 2.</p>

      <h2>What a capsule is</h2>
      <p>
        A simulation capsule is a portable, reproducible bundle of a single
        experiment. It carries the model, code, configs, data, results,
        validation evidence, and provenance. The directory form is canonical;
        an archive form (<code>.lxp.zip</code>) is for transport.
      </p>

      <h2>Capsule layout</h2>
      <pre>
        <code>{`<name>.lxp/
  manifest.toml
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
    diagnostics.parquet
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

      <h2>What capsules support</h2>
      <ul>
        <li>Save</li>
        <li>Load</li>
        <li>Fork</li>
        <li>Export code</li>
        <li>Export data</li>
        <li>Export report</li>
        <li>Rerun</li>
        <li>Inspect assumptions</li>
        <li>Inspect code</li>
        <li>Inspect validation status</li>
      </ul>

      <h2>Capsule lifecycle</h2>
      <ul>
        <li>In-flight runs live in <code>temp_runs/&lt;run_id&gt;/</code>.</li>
        <li>Promotion to a capsule moves the directory to <code>simulation_capsules/&lt;name&gt;.lxp/</code>.</li>
        <li>Forking creates a new capsule that references the parent's hash in its provenance chain.</li>
        <li><code>provenance/</code> is append-only after creation.</li>
      </ul>

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>The full <code>manifest.toml</code> schema.</li>
        <li>Bulk-data format choice (HDF5 / Zarr) — finalized in Phase 2.</li>
        <li>Migration paths between schema versions.</li>
        <li>Capsule diff and merge workflows.</li>
      </ul>
    </article>
  );
}

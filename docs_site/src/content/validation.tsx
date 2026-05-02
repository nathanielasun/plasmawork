export default function Validation() {
  return (
    <article>
      <h1>Validation</h1>
      <p className="page-status">
        Phase 1 complete. Three validation tests live under
        <code>tests/validation/</code> covering rate-equation conservation,
        Lennard-Jones energy drift, and 2D Ising critical-temperature
        crossover. The validation surface expands in Phase 7 (validated
        physics module registry).
      </p>

      <h2>Validation categories</h2>
      <table>
        <thead>
          <tr><th>Category</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <tr><td>Dimensional</td><td>Equations and parameters are unit-consistent.</td></tr>
          <tr><td>Conservation</td><td>Energy, charge, particles, momentum where applicable.</td></tr>
          <tr><td>Analytical</td><td>Match closed-form solutions in limiting cases.</td></tr>
          <tr><td>Benchmark</td><td>Match known computational or experimental results.</td></tr>
          <tr><td>Paper reproduction</td><td>Reproduce figures or tables from source papers.</td></tr>
          <tr><td>Cross-solver</td><td>Compare reduced and high-fidelity solver outputs.</td></tr>
          <tr><td>Convergence</td><td>Timestep, grid, particle-number convergence.</td></tr>
          <tr><td>Regression</td><td>Previous bugs remain fixed.</td></tr>
          <tr><td>Sensitivity</td><td>Identify fragile parameter dependencies.</td></tr>
        </tbody>
      </table>

      <h2>Validation status labels</h2>
      <table>
        <thead>
          <tr><th>Status</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr><td><code>unvalidated</code></td><td>Runs, but no meaningful validation completed.</td></tr>
          <tr><td><code>exploratory</code></td><td>Useful for conceptual exploration only.</td></tr>
          <tr><td><code>partially_validated</code></td><td>Some checks pass, gaps remain.</td></tr>
          <tr><td><code>validated</code></td><td>Passes required tests for the specified regime.</td></tr>
          <tr><td><code>trusted</code></td><td>Repeatedly validated and reviewed.</td></tr>
          <tr><td><code>failed</code></td><td>Known invalid or broken.</td></tr>
        </tbody>
      </table>

      <h2>Validation report</h2>
      <p>Each run produces:</p>
      <pre>
        <code>{`<capsule>/validation/
  validation_report.md
  validation_results.json
  validation_plots/`}</code>
      </pre>

      <h2>Required content of a validation report</h2>
      <ul>
        <li>Pass / fail summary.</li>
        <li>Tolerance levels.</li>
        <li>Numerical error.</li>
        <li>Physical interpretation.</li>
        <li>Limitations.</li>
        <li>Recommended next validation steps.</li>
      </ul>

      <h2>Agent rules around validation</h2>
      <ul>
        <li>Never lower a tolerance to make a failing validation test pass without an ADR.</li>
        <li>Never switch backends to make output look better.</li>
        <li>Never change validated module behavior in place — fork into a new candidate.</li>
      </ul>

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>How to author a benchmark case and link it to a module.</li>
        <li>How convergence tests are set up and read.</li>
        <li>The validation panel in the workbench UI.</li>
      </ul>
    </article>
  );
}

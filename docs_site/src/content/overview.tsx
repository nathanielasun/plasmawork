export default function Overview() {
  return (
    <article>
      <h1>Overview</h1>
      <p className="page-status">
        Current capability: the workbench can load structured ModelSpecs,
        run local simulations, inspect diagnostics, package results as
        portable capsules, validate artifacts, generate/review code inside
        capsule boundaries, and expose secure multi-user scaffolding for
        workspace-scoped operation.
      </p>

      <h2>What this is</h2>
      <p>
        The Scientific Simulation Workbench is a paper-to-experiment platform
        for laser physics, laser fusion, laser–species interaction, and
        adjacent computational physics. It lets a researcher transform a
        scientific paper into a structured, inspectable, testable,
        visualizable computational experiment — and bundles the result into a
        portable simulation capsule.
      </p>

      <h2>Conceptual workflow</h2>
      <pre>
        <code>{`Scientific paper
    ↓ extracted equations, parameters, regimes, diagnostics
ModelSpec (structured intermediate representation)
    ↓ mapped to validated reusable modules
Generated or composed experiment code
    ↓ run interactively, with diagnostics & visualization
Exportable reproducible simulation capsule (.lxp/)`}</code>
      </pre>

      <h2>Initial domain focus</h2>
      <p>
        Laser–species interaction (rate-equation kinetics, photoionization,
        absorption / emission, KrF excimer as the worked example). Internal
        abstractions are designed to extend to plasma kinetics, molecular
        dynamics, phase-transition analysis, Monte Carlo transport, PDE-based
        field simulations, and spectroscopy.
      </p>

      <h2>Design principles</h2>
      <ul>
        <li>Scientific inspectability — equations, units, assumptions, and validation status are always surfaced.</li>
        <li>Modular composition — paper-derived simulations are built from validated reusable modules.</li>
        <li>Hardware-invariant interface, hardware-specialized backends.</li>
        <li>Reproducibility by default — every run is a saveable, reloadable, exportable capsule.</li>
        <li>AI-assisted drafting with human review and audit gates for high-risk actions.</li>
      </ul>

      <h2>Where to go next</h2>
      <ul>
        <li>Use <strong>Installation</strong> to set up the local environment.</li>
        <li>Use <strong>Using the Workbench</strong> for launch commands and the basic experiment flow.</li>
        <li>Use <strong>Simulation Capsules</strong> to understand the saved artifact format.</li>
        <li>Use <strong>Validation</strong> to interpret status labels and benchmark evidence.</li>
      </ul>
    </article>
  );
}

export default function Overview() {
  return (
    <article>
      <h1>Overview</h1>
      <p className="page-status">
        Phase 1 — implementations of all six workstreams 1A–1F have landed,
        but a review identified seven legitimate issues (capsule save/reload,
        opt-in-to-default checker promotion, checkpoint guard order,
        placeholder coefficient surfacing, API state isolation, status sync,
        ruff). Close fixes are in flight. See{" "}
        <code>bugs_and_fixes/bugfixes.md</code> 2026-05-02 <em>Phase 1 false close</em>.
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
        <li>Agentic assistance with human audit gates.</li>
      </ul>

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>The end-to-end paper-to-experiment workflow with screenshots.</li>
        <li>The simulation capsule concept and why it matters.</li>
        <li>Validation status labels and what each one means in practice.</li>
        <li>Pointers to the architecture, capsule, and validation pages.</li>
      </ul>
    </article>
  );
}

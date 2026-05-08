export default function InternalTools() {
  return (
    <article>
      <h1>Internal Tools</h1>
      <p className="page-status">
        Internal tools are registered, inspectable extensions for import,
        diagnostics, visualization, validation, export, and assisted analysis.
        They are governed by lifecycle gates rather than ad-hoc scripts.
      </p>

      <h2>What they are</h2>
      <p>
        Internal tools are small, registered components — diagnostic tools,
        data importers, visualization tools, solver adapters, parameter-sweep
        helpers, paper parsers, validation tools, exporters. They are how
        teams extend the workbench without forking it.
      </p>

      <h2>Categories</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Examples</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Import</td><td>PDF importer, CSV parser, HDF5 loader, cross-section table importer</td></tr>
          <tr><td>Physics</td><td>photoionization module, collisional model, laser pulse model</td></tr>
          <tr><td>Solver</td><td>stiff ODE wrapper, PIC adapter, finite-volume solver</td></tr>
          <tr><td>Diagnostic</td><td>absorption spectrum plotter, energy budget, density histogram</td></tr>
          <tr><td>Visualization</td><td>2D particle viewer, field animation, phase-space viewer</td></tr>
          <tr><td>Export</td><td>notebook exporter, report generator, openPMD exporter</td></tr>
          <tr><td>Automation</td><td>paper summarizer, equation extractor, parameter matcher</td></tr>
          <tr><td>Validation</td><td>conservation checker, convergence tester, benchmark comparator</td></tr>
        </tbody>
      </table>

      <h2>Where they live</h2>
      <pre>
        <code>{`packages/internal_tools/registry/<tool_name>/
  tool.yaml
  README.md
  src/
  tests/
  docs/
  examples/`}</code>
      </pre>

      <h2>Tool lifecycle</h2>
      <pre>
        <code>{`draft → candidate → validated → trusted → deprecated`}</code>
      </pre>
      <p>
        New tools start as <code>draft</code> or <code>candidate</code>.
        Promotion to <code>validated</code> requires the tool's
        tests + reference cases to pass; promotion to <code>trusted</code>
        requires explicit human approval (plan §9.5). The lifecycle is
        enforced by the registry — illegal transitions raise{" "}
        <code>LifecycleError</code> and the API surfaces them as 400s, so
        the rule cannot be bypassed by calling the SDK directly.
      </p>

      <h2>Tutorial — author the absorption-spectrum diagnostic</h2>
      <p>
        The reference tool at{" "}
        <code>packages/internal_tools/registry/absorption_spectrum_diagnostic/</code>
        {" "}walks through every step. Reproduce it from scratch:
      </p>

      <h3>1. Copy a template</h3>
      <pre>
        <code>{`cp -r packages/internal_tools/templates/diagnostic \\
      packages/internal_tools/registry/my_diagnostic`}</code>
      </pre>
      <p>
        The diagnostic template ships with a <code>tool.yaml</code>,
        <code> src/tool.py</code>, and <code>README.md</code>. Open them
        and replace the <code>TEMPLATE</code> placeholder with your tool's
        real name. Or use the Tools page's <strong>Build tool from
        template</strong> panel, which creates the draft from server-known
        templates without granting arbitrary filesystem writes.
      </p>

      <h3>2. Declare inputs and outputs in tool.yaml</h3>
      <p>
        Every numeric port that crosses the tool boundary{" "}
        <strong>must declare units</strong>. Schema validation rejects
        an array port without a <code>units</code> field — this is the
        same boundary rule the ModelSpec validators enforce (plan §22).
        Example from the reference tool:
      </p>
      <pre>
        <code>{`inputs:
  - name: frequency
    type: array
    units: Hz
  - name: intensity
    type: array
    units: dimensionless

outputs:
  - name: peaks
    type: table
  - name: peak_count
    type: scalar`}</code>
      </pre>

      <h3>3. Implement validate_inputs and run</h3>
      <pre>
        <code>{`from simworkbench.tools import BaseTool, ToolInput, ToolOutput

class AbsorptionSpectrumDiagnostic(BaseTool):
    name = "absorption_spectrum_diagnostic"
    version = "0.1.0"

    def validate_inputs(self, inputs: ToolInput) -> None:
        inputs.require_array("frequency", units="Hz")
        inputs.require_array("intensity")

    def run(self, inputs: ToolInput) -> ToolOutput:
        # ... your logic here ...
        return ToolOutput({"peaks": peaks, "peak_count": len(peaks)})`}</code>
      </pre>
      <p>
        <code>require_array</code> rejects bare floats / numpy arrays —
        only <code>simworkbench.units.Q(values, "&lt;unit&gt;")</code>{" "}
        passes. <code>execute</code> wraps validate-then-run for callers,
        and the registry uses the same wrapper, so behavior is identical
        between the UI, assisted workflows, and direct Python invocations.
      </p>

      <h3>4. Add tests</h3>
      <p>
        Tests live under your tool's <code>tests/</code> subdirectory and
        run as part of the workbench test suite (the registry's tool
        directories are wired into pytest's <code>testpaths</code>).
      </p>

      <h3>5. Register and inspect</h3>
      <pre>
        <code>{`./scripts/dev/refresh_registry.sh`}</code>
      </pre>
      <p>
        The script rewalks <code>packages/internal_tools/registry/</code>
        and <code>local_cache/imported_tools/</code>, validates every
        <code> tool.yaml</code>, and rewrites the canonical{" "}
        <code>index.yaml</code>. Then open the workbench UI's{" "}
        <strong>Tools</strong> tab — your tool appears in the list,
        grouped by feature and frequency, with search for exact lookup and
        a clickable detail panel showing inputs, outputs, validation tests,
        and the lifecycle bar.
      </p>

      <h3>6. Promote</h3>
      <p>
        Click <strong>Promote to candidate</strong> in the detail panel
        to advance the lifecycle. <code>candidate → validated</code> and
        <code> validated → trusted</code> require explicit human approval;
        the API rejects unapproved promotion attempts with a 400 and the rule
        explanation.
      </p>

      <h2>Imported tools</h2>
      <p>
        External tool packages are copied into{" "}
        <code>local_cache/imported_tools/</code> on import (plan §9.7).
        Imports never scatter files across the user's home directory.
        The registry walks both that directory and{" "}
        <code>packages/internal_tools/registry/</code> on every refresh,
        so imported tools appear in the UI alongside built-in ones.
      </p>

      <h2>UI-native draft authoring</h2>
      <p>
        The Tools page can construct legitimate draft tools from templates.
        The browser talks to <code>/api/tool-authoring/*</code> endpoints; the
        backend creates drafts under{" "}
        <code>local_cache/workspaces/local/tool_drafts/</code>, keeps a local
        authoring audit log, and only exposes an allow-listed text-file editor.
      </p>
      <ol>
        <li>Select a server-known template and enter a valid lowercase tool name.</li>
        <li>Edit the visible package files such as <code>tool.yaml</code>, <code>src/tool.py</code>, tests, docs, and examples.</li>
        <li>Run the backend package checker. Registration is blocked unless the latest passing check matches the current content hash.</li>
        <li>Register the checked draft into <code>local_cache/imported_tools/</code> or export a draft archive for review.</li>
      </ol>
      <p>
        Draft authoring is intentionally not a general file manager. Hidden
        files, absolute paths, path traversal, oversized edits, NUL bytes, and
        symlinked draft paths are refused before package hashing, export, or
        registration.
      </p>

      <h2>Validation requirements</h2>
      <p>
        Every internal tool MUST include: purpose, inputs, outputs,
        units, example usage, valid domains, known limitations, tests,
        validation status, changelog. The registry's promotion logic
        rejects a move to <code>validated</code> when{" "}
        <code>validation.tests</code> is empty in <code>tool.yaml</code>.
      </p>

      <h2>Agent-assisted tool construction</h2>
      <p>
        The repository maintains a tool-construction skill for agents at{" "}
        <code>.agents/skills/simworkbench-tool-construction/SKILL.md</code>.
        It is the compact workflow for creating or changing internal tools:
        inspect bug memory, start from a template, write <code>tool.yaml</code>
        first, implement <code>BaseTool</code>, add tests and examples, run the
        package checker, verify UI binding, and update documentation.
      </p>
      <p>
        The skill is intentionally separate from this manual. This page explains
        how users and developers work with tools; the skill gives agents a
        concise, importable checklist plus references and a deterministic
        package checker.
      </p>

      <h2>General tool workbench</h2>
      <p>
        Tool metadata drives the UI binding. Inputs are rendered from the
        validated contract, including units, tables, arrays, booleans, strings,
        and artifact references. Outputs are rendered by declared kind: scalar,
        table, timeseries, image, diagram, file, report, or JSON inspection.
      </p>
      <p>
        The in-app tool library is a compact navigator rather than a full
        registry dump. It highlights the active tool, locally frequent tools,
        and capped feature groups such as data I/O, diagnostics, validation,
        visualization, and solver-facing utilities. Search is the intended
        path for exact lookup when the registry grows.
      </p>
      <p>
        Tool outputs that are too large or file-like are treated as artifacts
        rather than hidden inline JSON. Artifact viewers show type, size, hash,
        provenance, and a safe preview when available. Diagram rendering uses
        structured graph/flow/schema specifications; raw executable HTML or
        JavaScript output is not a supported renderer.
      </p>
    </article>
  );
}

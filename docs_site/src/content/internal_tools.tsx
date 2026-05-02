export default function InternalTools() {
  return (
    <article>
      <h1>Internal Tools</h1>
      <p className="page-status">Phase 0 skeleton. Expand in Phase 3.</p>

      <h2>What they are</h2>
      <p>
        Internal tools are small, registered components — diagnostic tools,
        data importers, visualization tools, solver adapters, parameter-sweep
        helpers, paper parsers, validation tools, exporters. They are how
        users (and agents) extend the workbench without forking it.
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
          <tr><td>Agent</td><td>paper summarizer, equation extractor, parameter matcher</td></tr>
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
        Agents may create <code>draft</code> and <code>candidate</code>.
        Promotion to <code>trusted</code> requires a human reviewer and the
        criteria in the module-development page.
      </p>

      <h2>Authoring a tool</h2>
      <ol>
        <li>From the workbench UI: <strong>Internal Tools → New Tool from Template</strong>, OR copy <code>packages/internal_tools/templates/&lt;category&gt;/</code> into the registry.</li>
        <li>Edit <code>tool.yaml</code>: name, version, type, entrypoint, declared inputs/outputs with units, compatible domains, requires, validation tests.</li>
        <li>Implement <code>src/tool.py</code> extending <code>simworkbench.tools.BaseTool</code> with <code>validate_inputs</code> and <code>run</code>.</li>
        <li>Add tests in <code>tests/</code>.</li>
        <li>Register: <code>./scripts/dev/refresh_registry.sh</code> (or restart the UI).</li>
      </ol>

      <h2>Imported tools</h2>
      <p>
        External tool packages are copied into <code>local_cache/imported_tools/</code> on import. Imports never scatter files across the user's home directory.
      </p>

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>Worked example: building the absorption-spectrum diagnostic from plan §9.4.</li>
        <li>The tool runtime contract — lifecycle hooks, error handling, units validation.</li>
        <li>Versioning and deprecation.</li>
      </ul>
    </article>
  );
}

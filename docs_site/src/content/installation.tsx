export default function Installation() {
  return (
    <article>
      <h1>Installation</h1>
      <p className="page-status">
        Phase 0 skeleton. Install scripts are placeholders until Phase 1.
      </p>

      <h2>Prerequisites (planned)</h2>
      <ul>
        <li>Python ≥ 3.11 — for the core, runtime, physics modules, and solver backends</li>
        <li>Node.js ≥ 20 — for the workbench UI and the documentation site</li>
        <li>A C/C++ toolchain — required only for compiled kernels (Phase 8)</li>
      </ul>

      <h2>Bootstrap</h2>
      <pre>
        <code>{`./scripts/dev/install.sh`}</code>
      </pre>
      <p>
        When implemented, this will create <code>.venv/</code>, install the
        Python workbench packages in editable mode, and install Node
        dependencies for the UI and docs site.
      </p>

      <h2>Manual install (until the script lands)</h2>
      <pre>
        <code>{`# Python core
python -m venv .venv
source .venv/bin/activate
pip install -e packages/core

# Docs site
cd docs_site && npm install`}</code>
      </pre>

      <h2>Local-only directories the workbench creates</h2>
      <p>
        After the first run, these directories are populated and remain local:
      </p>
      <ul>
        <li><code>local_cache/</code> — caches and downloaded coefficient tables</li>
        <li><code>temp_imports/</code> — staged paper imports awaiting review</li>
        <li><code>temp_runs/</code> — in-flight run artifacts</li>
        <li><code>simulation_capsules/</code> — finalized capsule directories</li>
      </ul>
      <p>All four are gitignored.</p>

      <h2>What this page should cover when expanded</h2>
      <ul>
        <li>OS-specific installation notes (macOS, Linux, Windows/WSL).</li>
        <li>Optional dependencies for accelerated backends (Numba, CUDA toolkit).</li>
        <li>Verifying the installation with the convention checker and a smoke test.</li>
      </ul>
    </article>
  );
}

export default function Installation() {
  return (
    <article>
      <h1>Installation</h1>
      <p className="page-status">
        The bootstrap path prepares the Python core, simulation packages,
        workbench UI, and documentation site for local development from a
        clean checkout.
      </p>

      <h2>Prerequisites</h2>
      <ul>
        <li>Python ≥ 3.11 — for the core, runtime, physics modules, and solver backends</li>
        <li>Node.js ≥ 20 — for the workbench UI and the documentation site</li>
        <li>A C/C++ toolchain — required only when building compiled kernels</li>
      </ul>

      <h2>Bootstrap</h2>
      <pre>
        <code>{`./scripts/dev/install.sh`}</code>
      </pre>
      <p>
        This creates <code>.venv/</code>, installs the Python packages in
        editable mode, and installs Node dependencies for the UI and docs site.
      </p>

      <h2>Manual install</h2>
      <pre>
        <code>{`# Python core
python -m venv .venv
source .venv/bin/activate
pip install -e packages/core

# Docs site
cd docs_site && npm install

# Workbench UI package
cd ../apps/workbench-ui && npm install`}</code>
      </pre>

      <h2>Command wrappers</h2>
      <p>
        The documented command paths exist even when a later workstream owns
        implementation details. A command that is intentionally unavailable in
        the current environment should fail with an explicit explanation rather
        than a missing-file error.
      </p>

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

      <h2>Verification</h2>
      <ul>
        <li>Run <code>./scripts/dev/check_repo_conventions.sh</code> to verify documented files and commands.</li>
        <li>Run <code>./scripts/test/all.sh</code> before claiming a repository-wide change is complete.</li>
        <li>Use backend-specific smoke tests when optional accelerated backends are enabled.</li>
      </ul>
    </article>
  );
}

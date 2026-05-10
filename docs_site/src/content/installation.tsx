export default function Installation() {
  return (
    <article>
      <h1>Installation</h1>
      <p className="page-status">
        The bootstrap path prepares the Python core, simulation packages,
        workbench UI, documentation site, and (since 2026-05-09) the
        Fastify auth gateway for local development from a clean checkout.
      </p>

      <h2>Prerequisites</h2>
      <ul>
        <li>Python ≥ 3.11 — for the core, runtime, physics modules, and solver backends</li>
        <li>Node.js ≥ 20 — for the workbench UI, the docs site, and the auth gateway</li>
        <li>A C/C++ toolchain — required only when building compiled kernels</li>
        <li>Postgres 16+ — required when running the auth gateway against secure-core</li>
      </ul>

      <h2>Bootstrap</h2>
      <pre>
        <code>{`./scripts/dev/install.sh`}</code>
      </pre>
      <p>
        This creates <code>.venv/</code>, installs the Python packages in
        editable mode, and installs Node dependencies for the UI, docs
        site, and the auth gateway.
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
cd ../apps/workbench-ui && npm install

# Auth gateway (Phase 0.5, 2026-05-09)
cd ../workbench-gateway && npm install`}</code>
      </pre>

      <h2>Two processes, two postures</h2>
      <p>
        After the Phase 0.5 auth gateway landed, the workbench runs as
        two cooperating processes. Local development supports two
        postures:
      </p>
      <ul>
        <li>
          <strong>Dev posture (default).</strong> Run the FastAPI
          workbench standalone via <code>scripts/dev/run_backend.sh</code>.
          The auth middleware skips HMAC verification when
          <code>WORKBENCH_GATEWAY_HANDOFF_SECRET</code> is unset, and
          falls back to a default workspace so existing examples and
          single-user research workflows continue to work. Use this for
          everyday Python work that does not exercise multi-tenant
          authorization.
        </li>
        <li>
          <strong>Gateway posture.</strong> Run both processes. The
          FastAPI workbench binds <code>127.0.0.1:8000</code> only and
          requires <code>WORKBENCH_GATEWAY_HANDOFF_SECRET</code> in its
          environment. The Fastify gateway at
          <code>apps/workbench-gateway/</code> is the public entry on
          <code>:4000</code>; it reads <code>/.env.auth</code> and signs
          every forwarded request. Use this when working on auth, the
          UI shell, or any code that touches workspace-scoped paths.
        </li>
      </ul>

      <h2>One-time `.env.auth` setup (gateway posture)</h2>
      <p>
        The gateway loader at
        <code>apps/workbench-gateway/src/env.ts</code> fails closed at
        startup if any required variable is missing or shorter than its
        security floor. Copy the committed example once and fill it:
      </p>
      <pre>
        <code>{`cp .env.auth.example .env.auth

# Generate the cookie + handoff secrets (32+ bytes each, base64).
openssl rand -base64 32   # → WORKBENCH_GATEWAY_COOKIE_SECRET
openssl rand -base64 32   # → WORKBENCH_GATEWAY_HANDOFF_SECRET`}</code>
      </pre>
      <p>
        The full env-var inventory and the first-boot bootstrap
        walkthrough live on the <strong>Authentication</strong> page
        under <em>Security and Operations</em>. <code>.env.auth</code>
        is gitignored; <code>.env.auth.example</code> is committed and
        is the source-controlled inventory.
      </p>

      <h2>Command wrappers</h2>
      <p>
        The documented command paths exist even when a later workstream
        owns implementation details. A command that is intentionally
        unavailable in the current environment fails closed with an
        explicit explanation rather than a missing-file error.
      </p>

      <h2>Local-only directories the workbench creates</h2>
      <p>
        After the first run, these directories are populated and remain
        local:
      </p>
      <ul>
        <li><code>local_cache/</code> — caches and downloaded coefficient tables</li>
        <li><code>temp_imports/&#123;workspace_slug&#125;/</code> — staged paper imports awaiting review (workspace-scoped under the gateway posture)</li>
        <li><code>temp_runs/&#123;workspace_slug&#125;/</code> — in-flight run artifacts (workspace-scoped under the gateway posture)</li>
        <li><code>simulation_capsules/&#123;workspace_slug&#125;/</code> — finalized capsule directories (workspace-scoped under the gateway posture)</li>
      </ul>
      <p>All four are gitignored. So is <code>/.env.auth</code>.</p>

      <h2>Verification</h2>
      <ul>
        <li>Run <code>./scripts/dev/check_repo_conventions.sh</code> to verify documented files and commands.</li>
        <li>Run <code>./scripts/test/all.sh</code> before claiming a repository-wide change is complete.</li>
        <li>Use backend-specific smoke tests when optional accelerated backends are enabled.</li>
        <li>Under the gateway posture, confirm a cold browser load of <code>http://localhost:4000/</code> redirects to <code>/login</code> and that submitting bootstrap-issued credentials lands on the workspace switcher.</li>
      </ul>
    </article>
  );
}

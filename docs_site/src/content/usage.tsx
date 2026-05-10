export default function Usage() {
  return (
    <article>
      <h1>Usage</h1>
      <p className="page-status">
        Start here when you want to run the workbench locally, create or load a
        structured experiment, execute it, inspect diagnostics, and preserve
        the result as a simulation capsule.
      </p>

      <h2>Starting the workbench</h2>
      <p>
        Phase 0.5 introduced an authentication gateway, so the dev model
        is now three cooperating processes. The Vite dev server proxies
        every UI-facing path (<code>/auth/*</code>, <code>/api/*</code>,
        <code>/bootstrap</code>, etc.) to the gateway on
        <code>:4000</code>; without something listening there, you'll see
        <em>"Could not load your session"</em> from the SPA. Two choices:
      </p>
      <h3>Zero-config dev (stub gateway)</h3>
      <pre>
        <code>{`# Terminal 1 — FastAPI on :8000
./scripts/dev/run_backend.sh

# Terminal 2 — stub gateway on :4000 (zero auth, NEVER use in prod)
./scripts/dev/run_dev_stub_gateway.sh

# Terminal 3 — UI on :5173
./scripts/dev/run_ui.sh`}</code>
      </pre>
      <p>
        The stub gateway (<code>scripts/dev/dev_stub_gateway.mjs</code>)
        is a 200-line Node script. It accepts ANY <code>/auth/login</code>
        credentials, mints a stub session, returns the right response
        shapes for <code>/auth/session</code>, and reverse-proxies
        <code>/api/*</code> to FastAPI. Use this when you want to dev
        the UI or backend without setting up Postgres, <code>.env.auth</code>,
        or a bootstrap admin.
      </p>
      <h3>Full auth (real gateway)</h3>
      <p>
        For login flows, multi-workspace, capability gating, or anything
        that touches the canonical audit chain, run the real
        <code>apps/workbench-gateway</code> in place of the stub. See
        the Installation page for the <code>.env.auth</code> setup and
        first-boot bootstrap; the gateway requires Postgres with the
        secure_core roles + migrations applied.
      </p>
      <h3>Windows / shell-neutral entrypoints for FastAPI</h3>
      <pre>
        <code>{`# Windows PowerShell / cmd.exe
.\\scripts\\dev\\run_backend.ps1
scripts\\dev\\run_backend.cmd

# Shell-neutral
python scripts/dev/run_backend.py

# Optional server flags
./scripts/dev/run_backend.sh --port 8000 --reload`}</code>
      </pre>
      <p>
        The backend command starts the FastAPI server consumed by the UI. It
        does not run a simulation by itself; simulations are started through
        API endpoints, UI controls, capsule rerun commands, or standalone
        example scripts.
      </p>

      <h2>Running a standalone example</h2>
      <pre>
        <code>{`python examples/simple_rate_equations/run.py --max-steps 25 --no-capsule`}</code>
      </pre>
      <p>
        Standalone examples are separate from the backend launcher. The backend
        launcher starts the API server only; it should not dispatch example
        simulations.
      </p>

      <h2>Creating an experiment manually</h2>
      <p>
        The minimum Python workflow is: load a <code>ModelSpec</code>, bind it
        to an <code>Experiment</code>, choose backend/run/diagnostic config,
        then save or reload the experiment YAML before running it through the
        runtime.
      </p>
      <pre>
        <code>{`from simworkbench import Experiment
from simworkbench.model_spec import load_yaml
from simworkbench.serialization import save_experiment, load_experiment

spec = load_yaml("examples/simple_rate_equations/model.yaml")
experiment = Experiment.from_model_spec(
    spec,
    run_config={"start_time": "0 s", "end_time": "25 ns"},
    backend_config={"name": "python_cpu"},
)
save_experiment(experiment, "temp_runs/simple_rate_equations_experiment.yaml")
reloaded = load_experiment("temp_runs/simple_rate_equations_experiment.yaml")`}</code>
      </pre>

      <h2>Run controls</h2>
      <ul>
        <li><strong>Start</strong> — begin a new run.</li>
        <li><strong>Pause / Resume</strong> — non-destructive, preserves runtime state.</li>
        <li><strong>Checkpoint</strong> — write a restore point to <code>checkpoints/</code>.</li>
        <li><strong>Stop</strong> — end the run; the partial capsule remains in <code>temp_runs/</code>.</li>
        <li><strong>Save as capsule</strong> — promote the run from <code>temp_runs/</code> to <code>simulation_capsules/</code>.</li>
      </ul>

      <h2>Inspecting a run</h2>
      <ul>
        <li>Code viewer — see exactly what was run.</li>
        <li>Diagnostics panel — line plots, heatmaps, statistics tables.</li>
        <li>Validation panel — dimensional checks, conservation, benchmark comparison.</li>
        <li>Provenance panel — environment, seeds, automation trace, package versions.</li>
      </ul>

      <h2>Exporting and rerunning capsules</h2>
      <pre>
        <code>{`./scripts/export/capsule.sh <capsule_dir> <target_dir> [--kinds code,data,plots,notebook,report,archive]
./scripts/dev/run_capsule.sh path/to/capsule.lxp`}</code>
      </pre>
      <p>
        Export requires both a capsule directory and an explicit target
        directory. Rerun uses an existing <code>.lxp/</code> capsule directory.
      </p>

      <h2>Next things to verify</h2>
      <ul>
        <li>End-to-end walkthrough with a real laser-species example.</li>
        <li>Panel-by-panel UI behavior for run controls, diagnostics, validation, and provenance.</li>
        <li>Common keyboard shortcuts and live-streaming behavior.</li>
      </ul>
    </article>
  );
}

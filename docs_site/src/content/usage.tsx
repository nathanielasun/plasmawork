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
      <pre>
        <code>{`# UI
./scripts/dev/run_ui.sh

# Backend / API server at http://127.0.0.1:8000
./scripts/dev/run_backend.sh

# Windows PowerShell / cmd.exe
.\\scripts\\dev\\run_backend.ps1
scripts\\dev\\run_backend.cmd

# Shell-neutral
python scripts/dev/run_backend.py

# Optional server flags
./scripts/dev/run_backend.sh --host 0.0.0.0 --port 8000 --reload`}</code>
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

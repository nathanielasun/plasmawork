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

# Backend / API
./scripts/dev/run_backend.sh`}</code>
      </pre>

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

      <h2>Next things to verify</h2>
      <ul>
        <li>End-to-end walkthrough with a real laser-species example.</li>
        <li>Panel-by-panel UI behavior for run controls, diagnostics, validation, and provenance.</li>
        <li>Common keyboard shortcuts and live-streaming behavior.</li>
      </ul>
    </article>
  );
}

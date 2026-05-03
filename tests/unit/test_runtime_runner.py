"""Phase 1C — Runner lifecycle and step-loop tests.

The runner is exercised against the built-in ``python_cpu`` backend on the
example simple-rate-equations ModelSpec. End-to-end pause/resume identity is
covered by ``tests/integration/test_runtime_pause_resume.py``.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.runtime import Runner, RunState, known_backends


def _example_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )


def _make_experiment(*, max_steps: int = 50) -> Experiment:
    spec = load_yaml(_example_path())
    return Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=max_steps),
    )


def test_known_backends_includes_python_cpu():
    assert "python_cpu" in known_backends()


def test_runner_lifecycle_states():
    runner = Runner(_make_experiment())
    assert runner.state == RunState.CREATED
    runner.prepare()
    assert runner.state == RunState.READY
    runner.start()
    assert runner.state == RunState.RUNNING
    runner.pause()
    assert runner.state == RunState.PAUSED
    runner.resume()
    assert runner.state == RunState.RUNNING
    runner.stop()
    assert runner.state == RunState.STOPPED


def test_run_completes_to_t_end():
    runner = Runner(_make_experiment(max_steps=20))
    result = runner.run()
    assert runner.state == RunState.COMPLETED
    assert result.state == RunState.COMPLETED
    assert result.final_simulation_time == pytest.approx(100e-9, rel=1e-9)


def test_run_emits_diagnostics_for_each_species():
    runner = Runner(_make_experiment(max_steps=10))
    result = runner.run()
    assert "time_seconds" in result.diagnostics
    assert "A" in result.diagnostics
    assert "B" in result.diagnostics
    # Should have one sample per output step (10 steps).
    assert len(result.diagnostics["A"]) == 10
    assert len(result.diagnostics["B"]) == 10


def test_run_conserves_total_density_within_tolerance():
    runner = Runner(_make_experiment(max_steps=20))
    result = runner.run()
    A_samples = result.diagnostics["A"]
    B_samples = result.diagnostics["B"]
    initial_total = A_samples[0] + B_samples[0]
    final_total = A_samples[-1] + B_samples[-1]
    # Particle conservation: A + B should be invariant.
    assert final_total == pytest.approx(initial_total, rel=1e-6)


def test_run_emits_lifecycle_events():
    runner = Runner(_make_experiment(max_steps=5))
    runner.run()
    msgs = [e.message for e in runner.events.history()]
    assert "runner ready" in msgs
    assert "run started" in msgs
    assert "run completed" in msgs


def test_run_progress_reaches_terminal():
    runner = Runner(_make_experiment(max_steps=5))
    runner.run()
    snap = runner.progress.snapshot()
    assert snap is not None
    assert snap.fraction == pytest.approx(1.0)
    assert runner.progress.finished


def test_pause_then_step_once_raises():
    runner = Runner(_make_experiment(max_steps=10))
    runner.run = lambda: None  # avoid running
    runner.prepare()
    runner.start()
    runner.pause()
    with pytest.raises(RuntimeError, match="Cannot step"):
        runner.step_once()


def test_unknown_backend_fails_at_prepare():
    spec = load_yaml(_example_path())
    # `BackendConfig` rejects unknown names at construction, so we have to
    # work around it: build the experiment with a valid name, then mutate.
    exp = Experiment.from_model_spec(spec)
    # Use a backend name that is in KNOWN_BACKENDS but not registered with the
    # runner: amrex (validated at the BackendConfig level, not registered).
    exp.backend_config.name = "amrex"  # type: ignore[misc]
    runner = Runner(exp)
    with pytest.raises(KeyError):
        runner.prepare()
    assert runner.state == RunState.FAILED


def test_checkpoint_writes_to_temp_runs():
    runner = Runner(_make_experiment(max_steps=5))
    runner.prepare()
    runner.start()
    # Step a few times so we have non-trivial state.
    for _ in range(3):
        runner.step_once()
    chk = runner.checkpoint()
    assert chk.step == 3
    assert chk.backend == "python_cpu"

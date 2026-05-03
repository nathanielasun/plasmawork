"""Phase 1E — Diagnostic streaming during a runtime run.

Integration test: a producer thread runs a 0D simulation and publishes its
per-step samples to a ``DiagnosticStream``; the test thread iterates the
stream and confirms it sees every sample in order.
"""

from __future__ import annotations

import threading
from pathlib import Path

import pytest
from simworkbench.diagnostics import DiagnosticStream
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.runtime import Runner


def _example_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )


def test_runner_streams_samples_to_diagnostic_stream():
    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=10),
    )
    runner = Runner(exp)
    stream = DiagnosticStream()

    # Bridge: every "checkpoint written" / "run completed" event is irrelevant
    # for this test. We instead use the runner's progress callback to push
    # snapshots into the stream as samples land.
    def _on_progress(update):
        stream.publish({"step": update.step, "fraction": update.fraction})

    runner.progress.add_callback(_on_progress)

    def _producer():
        runner.run()
        stream.close()

    thread = threading.Thread(target=_producer)
    thread.start()

    received: list[dict] = list(stream)
    thread.join(timeout=10)
    assert not thread.is_alive(), "Producer thread did not finish in time"

    # We expect 10 step updates + a terminal finish update — or the runner
    # may consolidate the terminal into its final step. Ensure at least 10
    # samples.
    assert len(received) >= 10
    # Step indices should be non-decreasing.
    steps = [s["step"] for s in received]
    assert steps == sorted(steps)


def test_publish_after_close_raises():
    stream = DiagnosticStream()
    stream.close()
    with pytest.raises(RuntimeError, match="closed"):
        stream.publish({"x": 1})

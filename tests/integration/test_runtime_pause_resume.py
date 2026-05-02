"""Phase 1C — Pause/resume identity test.

A run paused mid-flight, restored from a checkpoint, and resumed produces the
same final trajectory as a single uninterrupted run on the same backend.
This is the integration-level evidence for the runner's `pause/resume`
contract.
"""

from __future__ import annotations

from pathlib import Path

import pytest

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


def _experiment(max_steps: int) -> Experiment:
    spec = load_yaml(_example_path())
    return Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=max_steps),
    )


def test_pause_resume_identity_via_pause_only():
    """Pausing and resuming without checkpoint round-trip must be a no-op."""
    runner_a = Runner(_experiment(max_steps=20), run_id="identity-a", base_seed=0)
    a_result = runner_a.run()

    runner_b = Runner(_experiment(max_steps=20), run_id="identity-b", base_seed=0)
    runner_b.prepare()
    runner_b.start()
    # Drive ten steps, pause, resume, drive the rest.
    for _ in range(10):
        runner_b.step_once()
    runner_b.pause()
    runner_b.resume()
    while runner_b.state.value == "running":
        runner_b.step_once()
    b_result = runner_b.result()

    for key in ("A", "B"):
        assert len(a_result.diagnostics[key]) == len(b_result.diagnostics[key])
        for av, bv in zip(a_result.diagnostics[key], b_result.diagnostics[key]):
            assert av == pytest.approx(bv, rel=1e-9, abs=1e-9)


def test_pause_resume_identity_via_checkpoint_restore():
    """Checkpoint-restore from mid-run reproduces the uninterrupted trajectory."""
    runner_a = Runner(_experiment(max_steps=20), run_id="identity-c", base_seed=0)
    a_result = runner_a.run()

    # Run B to step 7, checkpoint, then start a new runner that restores
    # from that checkpoint and finishes.
    runner_b = Runner(_experiment(max_steps=20), run_id="identity-d", base_seed=0)
    runner_b.prepare()
    runner_b.start()
    for _ in range(7):
        runner_b.step_once()
    chk = runner_b.checkpoint()
    runner_b.stop()

    runner_c = Runner(_experiment(max_steps=20), run_id="identity-d", base_seed=0)
    runner_c.prepare()
    runner_c.restore(chk)
    runner_c.start()
    while runner_c.state.value == "running":
        runner_c.step_once()
    c_result = runner_c.result()

    # The final tails should match: A's diagnostics from step 7 onward equal
    # C's full diagnostics (C started recording at step 8 — its own first
    # step after restore).
    a_tail = a_result.diagnostics["A"][7:]
    c_full = c_result.diagnostics["A"]
    assert len(a_tail) == len(c_full)
    for av, cv in zip(a_tail, c_full):
        assert av == pytest.approx(cv, rel=1e-7, abs=1e-9)

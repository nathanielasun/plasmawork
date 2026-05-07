"""Performance smoke coverage for the default 0D runtime path.

This is intentionally a generous regression guard, not a benchmark. Its main
job is to prevent the performance test lane from staying empty after the full
phase plan has closed.
"""

from __future__ import annotations

import time
from pathlib import Path

from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.runtime import Runner, RunState

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_simple_rate_equation_runtime_smoke_under_generous_budget() -> None:
    """A small LSODA-backed run should complete quickly on local dev hosts."""
    spec = load_yaml(REPO_ROOT / "examples" / "simple_rate_equations" / "model.yaml")
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=20),
    )

    started = time.perf_counter()
    result = Runner(experiment, base_seed=0).run()
    elapsed = time.perf_counter() - started

    assert result.state == RunState.COMPLETED
    assert elapsed < 10.0

"""Phase 1D validation — particle conservation for the simple-rate-equations example.

The ModelSpec at ``examples/simple_rate_equations/model.yaml`` declares
A + B as a conservation law. This test asserts the runner respects it
within solver tolerance.
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


def test_total_density_is_conserved_within_solver_tolerance():
    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="500 ns", max_steps=200),
    )
    runner = Runner(exp)
    result = runner.run()
    A = result.diagnostics["A"]
    B = result.diagnostics["B"]
    initial_total = A[0] + B[0]
    drift = max(abs((a + b) - initial_total) / initial_total for a, b in zip(A, B))
    # solve_ivp atol=1e-12 / rtol=1e-8 → drift well under 1e-6.
    assert drift < 1e-6


def test_B_is_monotone_non_decreasing():
    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="500 ns", max_steps=100),
    )
    runner = Runner(exp)
    result = runner.run()
    B = result.diagnostics["B"]
    for prev, curr in zip(B, B[1:]):
        # Allow a tiny solver wobble below atol.
        assert curr >= prev - 1e-6 * max(abs(prev), 1.0)


def test_A_decays_under_laser_drive():
    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="500 ns", max_steps=100),
    )
    runner = Runner(exp)
    result = runner.run()
    A = result.diagnostics["A"]
    assert A[-1] < A[0], "Expected A density to decay under laser drive"

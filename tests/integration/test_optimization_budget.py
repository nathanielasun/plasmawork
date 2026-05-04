"""Phase 9 / 9B — Optimization budget + constraint integration tests.

Exercises:
  - Budget cap (no overrun, single-source-of-truth).
  - Early-stop threshold.
  - Constraint handling (rejections counted, budget includes them).
  - Multi-objective scalarization.
  - BayesianOptimizerHook returns a structured error when skopt is
    not installed.
"""

from __future__ import annotations

import pytest
from simworkbench.optimization import (
    BayesianOptimizerHook,
    BayesianUnavailable,
    OptimizationProblem,
    RandomSearchOptimizer,
)


def test_budget_zero_rejected_at_problem_construction():
    with pytest.raises(ValueError, match="budget must be positive"):
        OptimizationProblem(
            parameters={"x": (0.0, 1.0)},
            objective=lambda p: float(p["x"]),
            budget=0,
        )


def test_constraint_rejections_counted_in_budget():
    counter = {"executed": 0}

    def objective(p):
        counter["executed"] += 1
        return float(p["x"])

    # The constraint accepts only x > 0.5; about half of uniform draws.
    problem = OptimizationProblem(
        parameters={"x": (-1.0, 1.0)},
        objective=objective,
        budget=20,
        constraints=lambda p: p["x"] > 0.5,
    )
    result = RandomSearchOptimizer(seed=0).optimize(problem)
    # Total budget is 20 = executed + rejected.
    assert result.evaluations == 20
    assert counter["executed"] + result.rejected_by_constraints == 20
    # At least some rejections happened (sanity check).
    assert result.rejected_by_constraints > 0


def test_multi_objective_scalarization():
    """A 2-component objective is scalarized via the weight vector."""

    def two_objectives(p):
        return [float(p["x"]) ** 2, abs(float(p["x"]) - 2.0)]

    problem = OptimizationProblem(
        parameters={"x": (-3.0, 3.0)},
        objective=two_objectives,
        budget=50,
        # Weight x^2 strongly; the optimizer will minimize x^2.
        scalarization_weights=(1.0, 0.001),
    )
    result = RandomSearchOptimizer(seed=0).optimize(problem)
    assert abs(result.best_parameters["x"]) < 0.5


def test_early_stop_threshold_minimize():
    problem = OptimizationProblem(
        parameters={"x": (-3.0, 3.0), "y": (-3.0, 3.0)},
        objective=lambda p: float(p["x"]) ** 2 + float(p["y"]) ** 2,
        budget=10000,
        early_stop_threshold=0.1,
    )
    result = RandomSearchOptimizer(seed=0).optimize(problem)
    assert result.stopped_reason == "early_stop"
    assert result.evaluations < 10000


def test_bayesian_unavailable_raises_structured_error_when_skopt_missing():
    """If scikit-optimize isn't installed, the hook raises a
    structured BayesianUnavailable rather than a bare ImportError."""
    try:
        import skopt  # noqa: F401  type: ignore[import-untyped]
    except Exception:
        problem = OptimizationProblem(
            parameters={"x": (-1.0, 1.0)},
            objective=lambda p: float(p["x"]),
            budget=10,
        )
        with pytest.raises(BayesianUnavailable, match="scikit-optimize"):
            BayesianOptimizerHook(seed=0).optimize(problem)
    else:
        pytest.skip("skopt is installed; the negative path test is skipped.")

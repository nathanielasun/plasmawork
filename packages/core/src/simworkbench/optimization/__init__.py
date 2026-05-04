"""Phase 9 / 9B — Optimization engine.

Public API::

    from simworkbench.optimization import (
        OptimizationProblem, OptimizationResult, Optimizer,
        RandomSearchOptimizer, BayesianOptimizerHook, BayesianUnavailable,
    )

The optimizer ABC accepts an ``OptimizationProblem`` (parameter
ranges + objective + budget + early-stop threshold) and returns an
``OptimizationResult`` with the best parameters / value / evaluation
count / stop reason.

Plan §Phase 9 / 9B bullets:
  1. Bayesian optimization hooks — ``BayesianOptimizerHook`` (skopt
     optional dep; raises ``BayesianUnavailable`` until installed).
  2. Multi-objective optimization — ``OptimizationProblem`` accepts
     a list of objectives + a scalarization weight vector.
  3. Constraint handling — ``constraints=`` callable returns a
     boolean for each candidate; constrained candidates skip.
  4. Compute-budget limits — ``budget`` is the hard cap; no
     bypass kwargs (Phase-7/8 audit lesson).
  5. Early stopping — ``early_stop_threshold`` lets the optimizer
     exit before exhausting the budget when the objective is
     "good enough".
"""

from __future__ import annotations

from .bayesian import BayesianOptimizerHook, BayesianUnavailable
from .problem import (
    OptimizationProblem,
    OptimizationResult,
    Optimizer,
)
from .random_search import RandomSearchOptimizer

__all__ = [
    "BayesianOptimizerHook",
    "BayesianUnavailable",
    "OptimizationProblem",
    "OptimizationResult",
    "Optimizer",
    "RandomSearchOptimizer",
]

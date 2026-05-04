"""Phase 9 / 9B — Bayesian optimizer hook (optional dep).

Phase 9 ships the contract; the heavy implementation requires
``scikit-optimize`` (skopt) as an optional dep. When skopt isn't
installed, ``BayesianOptimizerHook.optimize`` raises
``BayesianUnavailable`` so callers can fall back to RandomSearch
explicitly.

Per Phase-7/8 audit lessons: there is NO bypass kwarg. The budget
is hard-capped; early stopping is the only legitimate exit.
"""

from __future__ import annotations

from dataclasses import dataclass

from .problem import OptimizationProblem, OptimizationResult, Optimizer


class BayesianUnavailable(RuntimeError):
    """``scikit-optimize`` is not installed."""


@dataclass
class BayesianOptimizerHook(Optimizer):
    """Hook for skopt-based Bayesian optimization.

    The hook is intentionally thin: ``optimize`` checks for skopt at
    call time and uses it when available. This keeps skopt out of the
    workbench's required deps while the contract is documented.
    """

    seed: int = 0

    def optimize(self, problem: OptimizationProblem) -> OptimizationResult:
        try:
            from skopt import gp_minimize  # type: ignore[import-untyped]
            from skopt.space import Real  # type: ignore[import-untyped]
        except Exception as exc:  # noqa: BLE001
            raise BayesianUnavailable(
                "scikit-optimize is not installed. Install with "
                "`pip install scikit-optimize` and re-run, or use "
                "RandomSearchOptimizer instead."
            ) from exc

        names = list(problem.parameters.keys())
        space = [
            Real(low, high, name=name)
            for name, (low, high) in (
                (n, problem.parameters[n]) for n in names
            )
        ]

        history: list[tuple[dict[str, float], float]] = []
        rejected = 0
        stopped = "completed"

        sign = 1.0 if problem.minimize else -1.0

        def _wrapped(values):  # noqa: ANN001 — skopt callback shape
            point = {n: float(v) for n, v in zip(names, values, strict=True)}
            if problem.constraints is not None and not problem.constraints(point):
                nonlocal rejected
                rejected += 1
                # skopt requires a real number; return a deliberately
                # bad value so the surrogate avoids this region.
                return 1e30 if problem.minimize else -1e30
            value = self._evaluate(problem, point)
            history.append((dict(point), value))
            return sign * value

        result = gp_minimize(
            _wrapped,
            space,
            n_calls=problem.budget,
            random_state=self.seed,
        )
        best_values_unwrapped = sign * result.fun  # undo sign flip
        best_params = {
            n: float(v) for n, v in zip(names, result.x, strict=True)
        }
        if problem.early_stop_threshold is not None:
            if problem.minimize and best_values_unwrapped <= problem.early_stop_threshold:
                stopped = "early_stop"
            elif not problem.minimize and best_values_unwrapped >= problem.early_stop_threshold:
                stopped = "early_stop"

        if stopped == "completed" and len(history) + rejected >= problem.budget:
            stopped = "budget_cap"

        return OptimizationResult(
            best_parameters=best_params,
            best_value=float(best_values_unwrapped),
            evaluations=len(history) + rejected,
            rejected_by_constraints=rejected,
            history=history,
            stopped_reason=stopped,
        )


__all__ = ["BayesianOptimizerHook", "BayesianUnavailable"]

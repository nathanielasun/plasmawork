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

        # Phase-9 audit lesson: the prior implementation only
        # *labeled* the result as "early_stop"; it didn't actually stop
        # gp_minimize early. The threshold was checked AFTER all
        # ``budget`` calls finished. Use skopt's callback to actually
        # terminate as soon as the best executed value crosses the
        # threshold.
        early_threshold = problem.early_stop_threshold
        early_triggered = {"hit": False}

        def _early_stop_cb(_res):  # noqa: ANN001 — skopt callback shape
            if early_threshold is None:
                return False
            if not history:
                return False
            best = (
                min(v for _, v in history)
                if problem.minimize
                else max(v for _, v in history)
            )
            if problem.minimize and best <= early_threshold:
                early_triggered["hit"] = True
                return True
            if not problem.minimize and best >= early_threshold:
                early_triggered["hit"] = True
                return True
            return False

        result = gp_minimize(
            _wrapped,
            space,
            n_calls=problem.budget,
            random_state=self.seed,
            callback=_early_stop_cb,
        )
        if history:
            # ``result.fun`` reflects the sign-flipped surrogate value
            # the surrogate saw; the executed history is the truth.
            best_value = (
                min(v for _, v in history)
                if problem.minimize
                else max(v for _, v in history)
            )
            best_idx = next(i for i, (_, v) in enumerate(history) if v == best_value)
            best_params = dict(history[best_idx][0])
        else:
            best_value = sign * float(result.fun)
            best_params = {
                n: float(v) for n, v in zip(names, result.x, strict=True)
            }

        if early_triggered["hit"]:
            stopped = "early_stop"
        elif len(history) + rejected >= problem.budget:
            stopped = "budget_cap"

        return OptimizationResult(
            best_parameters=best_params,
            best_value=float(best_value),
            evaluations=len(history),
            rejected_by_constraints=rejected,
            history=history,
            stopped_reason=stopped,
        )


__all__ = ["BayesianOptimizerHook", "BayesianUnavailable"]

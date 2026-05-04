"""Phase 9 / 9B — RandomSearch optimizer.

Uniform-random sampling of the parameter space, keeping the best
result. Concrete and deterministic with a fixed seed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .problem import OptimizationProblem, OptimizationResult, Optimizer


@dataclass
class RandomSearchOptimizer(Optimizer):
    """Uniform-random search.

    Carries Phase-7/8 audit lessons:
      - The budget is the cap. There is NO ``ignore_budget`` /
        ``unbounded`` kwarg. A regression test inspects the
        signature.
      - ``early_stop_threshold`` is the only legitimate way to exit
        before the budget is exhausted.
    """

    seed: int = 0
    _rng: np.random.Generator = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._rng = np.random.default_rng(self.seed)

    def optimize(self, problem: OptimizationProblem) -> OptimizationResult:
        names = list(problem.parameters.keys())
        bounds = [problem.parameters[n] for n in names]
        # rng instance per-call so two calls with seed=0 reproduce.
        rng = np.random.default_rng(self.seed)

        best_params: dict[str, float] = {}
        best_value = float("inf") if problem.minimize else float("-inf")
        history: list[tuple[dict[str, float], float]] = []
        executed = 0
        rejected = 0
        stopped = "completed"

        for _ in range(problem.budget):
            point = {
                name: float(rng.uniform(low, high))
                for name, (low, high) in zip(names, bounds, strict=True)
            }
            if problem.constraints is not None and not problem.constraints(point):
                rejected += 1
                continue
            value = self._evaluate(problem, point)
            executed += 1
            history.append((dict(point), value))

            if problem.minimize and value < best_value:
                best_value, best_params = value, dict(point)
            elif not problem.minimize and value > best_value:
                best_value, best_params = value, dict(point)

            if problem.early_stop_threshold is not None:
                if problem.minimize:
                    if best_value <= problem.early_stop_threshold:
                        stopped = "early_stop"
                        break
                elif best_value >= problem.early_stop_threshold:
                    stopped = "early_stop"
                    break

        if executed + rejected >= problem.budget and stopped == "completed":
            stopped = "budget_cap"
        # Phase-9 audit lesson: when every candidate is rejected by
        # constraints, returning ``best_parameters={}`` + ``best_value=inf``
        # silently looks like "best is infinity" to a downstream caller.
        # Replace with a structured "no valid candidate" status so the
        # caller can branch on stopped_reason instead of inspecting the
        # sentinel value.
        if executed == 0 and rejected > 0:
            stopped = "all_candidates_rejected"
            best_value = float("nan")

        return OptimizationResult(
            best_parameters=best_params,
            best_value=best_value,
            evaluations=executed,
            rejected_by_constraints=rejected,
            history=history,
            stopped_reason=stopped,
        )


__all__ = ["RandomSearchOptimizer"]

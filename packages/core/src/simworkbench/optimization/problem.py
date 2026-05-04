"""Phase 9 / 9B — OptimizationProblem + Optimizer ABC."""

from __future__ import annotations

import abc
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

# Either a single scalar objective ``params -> float``, or a multi-
# objective callable ``params -> Sequence[float]``. The optimizer
# scalarizes via ``scalarization_weights``.
SingleObjective = Callable[[dict[str, float]], float]
MultiObjective = Callable[[dict[str, float]], Sequence[float]]


@dataclass
class OptimizationProblem:
    """Optimization problem declaration.

    ``parameters`` maps name → ``(low, high)`` for each continuous
    dimension. ``objective`` returns a float (single-objective) or a
    Sequence[float] (multi-objective; combined via
    ``scalarization_weights``).

    ``budget`` is the HARD cap on objective evaluations; the
    optimizer never exceeds it. ``early_stop_threshold`` lets the
    optimizer exit before exhausting the budget when the objective
    is good enough (lower is better when ``minimize=True``).

    ``constraints`` is an optional callable
    ``params -> bool``; a candidate that fails the constraint is
    counted as a "rejected" evaluation but never executed. The hard
    budget covers BOTH executed and rejected evaluations to prevent
    infinite spin on a tight constraint set.
    """

    parameters: dict[str, tuple[float, float]]
    objective: SingleObjective | MultiObjective
    budget: int
    minimize: bool = True
    scalarization_weights: tuple[float, ...] = ()
    constraints: Callable[[dict[str, float]], bool] | None = None
    early_stop_threshold: float | None = None
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.parameters:
            raise ValueError("OptimizationProblem.parameters must be non-empty.")
        for name, decl in self.parameters.items():
            if not (isinstance(decl, tuple) and len(decl) == 2):
                raise ValueError(
                    f"Parameter {name!r} must declare (low, high); got {decl!r}."
                )
            low, high = decl
            if not (low < high):
                raise ValueError(
                    f"Parameter {name!r} requires low < high; got "
                    f"({low!r}, {high!r})."
                )
        if self.budget <= 0:
            raise ValueError(
                f"OptimizationProblem.budget must be positive; got "
                f"{self.budget!r}. There is no bypass."
            )

    def scalarize(
        self, raw: float | Sequence[float]
    ) -> float:
        """Combine a multi-objective tuple into one scalar via the
        weight vector. Single-objective returns are passed through."""
        if isinstance(raw, (int, float)):
            return float(raw)
        weights = self.scalarization_weights or tuple(1.0 for _ in raw)
        if len(weights) != len(raw):
            raise ValueError(
                "scalarization_weights length doesn't match objective "
                "vector size."
            )
        return float(sum(w * v for w, v in zip(weights, raw, strict=True)))


@dataclass
class OptimizationResult:
    """Output of one optimizer run."""

    best_parameters: dict[str, float]
    best_value: float
    evaluations: int
    rejected_by_constraints: int = 0
    history: list[tuple[dict[str, float], float]] = field(default_factory=list)
    stopped_reason: str = "completed"


class Optimizer(abc.ABC):
    """Optimizer ABC. Concrete subclasses implement ``optimize``."""

    @abc.abstractmethod
    def optimize(self, problem: OptimizationProblem) -> OptimizationResult:
        """Run the optimizer to completion (or budget cap, or early stop)."""

    @staticmethod
    def _evaluate(
        problem: OptimizationProblem, params: dict[str, float]
    ) -> float:
        raw = problem.objective(params)
        return problem.scalarize(raw)


__all__ = [
    "MultiObjective",
    "OptimizationProblem",
    "OptimizationResult",
    "Optimizer",
    "SingleObjective",
]

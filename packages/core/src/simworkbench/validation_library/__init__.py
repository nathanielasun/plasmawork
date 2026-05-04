"""Phase 7 / 7E — Validation library.

Plan §Phase 7 / 7E enumerates five task bullets:

  1. Add analytic benchmark cases.
  2. Add paper reproduction cases.
  3. Add conservation checks.
  4. Add convergence tests.
  5. Add cross-solver comparison.

Each becomes a small dataclass / class with a structured ``Result``
return type so callers can compose them without inventing the
contract per-module. The library is deterministic, offline-safe, and
imports nothing from the runtime — modules call it from their own
``benchmarks/`` directories.

Example::

    check = ConservationCheck(
        name="mass conservation",
        quantity_at=lambda result, t: result.diagnostics["A"][t]
            + result.diagnostics["B"][t],
        tolerance_relative=1e-3,
    )
    report = check.evaluate(result)
    assert report.passed, report.detail

Per the Phase-6 audit lesson "Validation runs the source-of-truth, not
the generated artifact", these helpers compare against the artifact
the caller hands over — they don't go looking for a different one.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class ValidationReport:
    """Structured result every validation helper returns."""

    name: str
    passed: bool
    metric: float
    tolerance: float
    detail: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# 1 + 2. Analytic benchmark / paper reproduction.
# ---------------------------------------------------------------------------


@dataclass
class PaperReproduction(Generic[T]):
    """Compare a simulation result against a paper-reported value.

    ``observed(result)`` extracts a float from the simulation; the
    helper compares against ``expected`` with a relative tolerance.

    Used by laser-species modules to verify Lambert-Beer absorption,
    Lennard-Jones equilibrium energy, etc.
    """

    name: str
    observed: Callable[[T], float]
    expected: float
    tolerance_relative: float = 0.01
    reference: str = ""

    def evaluate(self, result: T) -> ValidationReport:
        actual = float(self.observed(result))
        if self.expected == 0.0:
            metric = abs(actual)
            passed = metric <= self.tolerance_relative
        else:
            metric = abs(actual - self.expected) / abs(self.expected)
            passed = metric <= self.tolerance_relative
        detail = (
            f"observed={actual:.6g}, expected={self.expected:.6g}, "
            f"relative_error={metric:.3e}, tolerance={self.tolerance_relative:.3e}"
        )
        return ValidationReport(
            name=self.name,
            passed=passed,
            metric=metric,
            tolerance=self.tolerance_relative,
            detail=detail,
            metadata={"reference": self.reference},
        )


# ---------------------------------------------------------------------------
# 3. Conservation checks (mass / charge / energy).
# ---------------------------------------------------------------------------


@dataclass
class ConservationCheck(Generic[T]):
    """Assert a derived quantity is conserved across the run.

    ``quantity_series(result)`` returns a 1D iterable of floats sampled
    over time. The helper measures the maximum relative drift from the
    series's first sample and compares against ``tolerance_relative``.
    """

    name: str
    quantity_series: Callable[[T], Sequence[float]]
    tolerance_relative: float = 1e-4

    def evaluate(self, result: T) -> ValidationReport:
        series = list(self.quantity_series(result))
        if len(series) < 2:
            return ValidationReport(
                name=self.name,
                passed=False,
                metric=float("nan"),
                tolerance=self.tolerance_relative,
                detail="Series has < 2 samples; cannot evaluate conservation.",
            )
        baseline = series[0]
        if baseline == 0:
            drift = max(abs(v) for v in series)
            metric = drift
            passed = metric <= self.tolerance_relative
        else:
            drift = max(abs(v - baseline) / abs(baseline) for v in series)
            metric = drift
            passed = metric <= self.tolerance_relative
        return ValidationReport(
            name=self.name,
            passed=passed,
            metric=metric,
            tolerance=self.tolerance_relative,
            detail=(
                f"baseline={baseline:.6g}, max_drift={drift:.3e}, "
                f"n_samples={len(series)}"
            ),
        )


# ---------------------------------------------------------------------------
# 4. Convergence test.
# ---------------------------------------------------------------------------


@dataclass
class ConvergenceCheck:
    """Assert an error decreases at the expected order as a control
    parameter (e.g. grid spacing, timestep) shrinks.

    The user supplies ``run_at(parameter)`` which returns an error
    metric. The helper computes log-log slope across the parameter
    sweep and asserts ``order_observed >= order_expected -
    tolerance``.
    """

    name: str
    run_at: Callable[[float], float]
    parameters: Sequence[float]
    order_expected: float = 2.0
    tolerance: float = 0.25

    def evaluate(self) -> ValidationReport:
        if len(self.parameters) < 2:
            return ValidationReport(
                name=self.name,
                passed=False,
                metric=float("nan"),
                tolerance=self.tolerance,
                detail="Need at least 2 parameter values for convergence.",
            )
        params = sorted(self.parameters, reverse=True)
        errors = [float(self.run_at(p)) for p in params]
        # log-log slope between consecutive (param, error) pairs.
        slopes: list[float] = []
        for i in range(len(params) - 1):
            p1, p2 = params[i], params[i + 1]
            e1, e2 = errors[i], errors[i + 1]
            if e1 <= 0 or e2 <= 0 or p1 == p2:
                continue
            slopes.append(
                (math.log(e2) - math.log(e1))
                / (math.log(p2) - math.log(p1))
            )
        if not slopes:
            return ValidationReport(
                name=self.name,
                passed=False,
                metric=float("nan"),
                tolerance=self.tolerance,
                detail="No usable slope (zero or negative errors?).",
            )
        observed = sum(slopes) / len(slopes)
        metric = self.order_expected - observed
        passed = metric <= self.tolerance
        return ValidationReport(
            name=self.name,
            passed=passed,
            metric=metric,
            tolerance=self.tolerance,
            detail=(
                f"order_observed={observed:.3f}, "
                f"order_expected={self.order_expected:.3f}, "
                f"params={list(params)}"
            ),
        )


# ---------------------------------------------------------------------------
# 5. Cross-solver comparison.
# ---------------------------------------------------------------------------


@dataclass
class CrossSolverComparison(Generic[T]):
    """Run two solver implementations and assert their outputs agree."""

    name: str
    series_a: Callable[[T], Sequence[float]]
    series_b: Callable[[T], Sequence[float]]
    tolerance_relative: float = 1e-3

    def evaluate(self, result_a: T, result_b: T) -> ValidationReport:
        a = list(self.series_a(result_a))
        b = list(self.series_b(result_b))
        if len(a) != len(b):
            return ValidationReport(
                name=self.name,
                passed=False,
                metric=float("nan"),
                tolerance=self.tolerance_relative,
                detail=(
                    f"Series length mismatch: |a|={len(a)} vs |b|={len(b)}. "
                    "Sample on a common time grid before comparing."
                ),
            )
        if not a:
            return ValidationReport(
                name=self.name,
                passed=False,
                metric=float("nan"),
                tolerance=self.tolerance_relative,
                detail="Empty series.",
            )
        max_rel = 0.0
        for av, bv in zip(a, b, strict=True):
            denom = max(abs(av), abs(bv), 1e-300)
            max_rel = max(max_rel, abs(av - bv) / denom)
        passed = max_rel <= self.tolerance_relative
        return ValidationReport(
            name=self.name,
            passed=passed,
            metric=max_rel,
            tolerance=self.tolerance_relative,
            detail=f"max_relative_error={max_rel:.3e}, n_samples={len(a)}",
        )


__all__ = [
    "ConservationCheck",
    "ConvergenceCheck",
    "CrossSolverComparison",
    "PaperReproduction",
    "ValidationReport",
]

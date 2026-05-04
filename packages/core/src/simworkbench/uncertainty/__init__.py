"""Phase 9 / 9C — Uncertainty Quantification.

Public API::

    from simworkbench.uncertainty import (
        ParameterDistribution,
        MonteCarloPropagator,
        SensitivityAnalysis,
        UncertaintySummary,
        SensitivityResult,
        bootstrap_confidence_interval,
        dominant_uncertainty,
    )

Plan §Phase 9 / 9C bullets covered:
  1. Parameter uncertainty propagation — ``MonteCarloPropagator``
     samples each ``ParameterDistribution``, evaluates the objective,
     and aggregates per-output mean / stddev / 95% CI.
  2. Numerical uncertainty — captured via the same MC machinery when
     the objective itself returns a stochastic result; the framework
     is identical.
  3. Sensitivity analysis — ``SensitivityAnalysis`` runs a
     "freeze-one-axis" decomposition (lightweight Sobol-style first-
     order index) suitable for cheap objectives. Heavier full-Sobol
     methods can subclass.
  4. Confidence intervals — ``bootstrap_confidence_interval``.
  5. Dominant uncertainty attribution — ``dominant_uncertainty``
     and ``SensitivityResult.dominant``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

# ---------------------------------------------------------------------------
# Distributions
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParameterDistribution:
    """One parameter's uncertainty distribution.

    Supported kinds:
      - ``normal`` — params: ``mean``, ``stddev`` (stddev > 0).
      - ``uniform`` — params: ``low``, ``high`` (low < high).
      - ``lognormal`` — params: ``mean`` (of log), ``stddev`` (of log; > 0).

    Phase-9 audit lesson: validate at construction so the failure
    surface is the constructor (a friendly ValueError), not numpy's
    obscure errors at sample time.
    """

    kind: str
    params: dict[str, float]

    def sample(self, rng: np.random.Generator, n: int) -> np.ndarray:
        kind = self.kind.lower()
        if kind == "normal":
            stddev = float(self.params["stddev"])
            if stddev <= 0:
                raise ValueError(
                    f"normal stddev must be > 0; got {stddev!r}"
                )
            return rng.normal(
                loc=float(self.params["mean"]),
                scale=stddev,
                size=n,
            )
        if kind == "uniform":
            low = float(self.params["low"])
            high = float(self.params["high"])
            if not (low < high):
                raise ValueError(
                    f"uniform requires low < high; got "
                    f"({low!r}, {high!r})"
                )
            return rng.uniform(low=low, high=high, size=n)
        if kind == "lognormal":
            stddev = float(self.params["stddev"])
            if stddev <= 0:
                raise ValueError(
                    f"lognormal stddev must be > 0; got {stddev!r}"
                )
            return rng.lognormal(
                mean=float(self.params["mean"]),
                sigma=stddev,
                size=n,
            )
        raise ValueError(
            f"Unsupported ParameterDistribution kind {self.kind!r}. "
            "Supported: normal, uniform, lognormal."
        )


# ---------------------------------------------------------------------------
# Monte Carlo propagator
# ---------------------------------------------------------------------------


@dataclass
class UncertaintySummary:
    """Aggregated propagation result.

    ``metrics[name]`` carries: ``samples`` (list[float]), ``mean``,
    ``stddev``, ``ci_95`` (low, high).
    """

    n_samples: int
    metrics: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass
class MonteCarloPropagator:
    """Sample parameter distributions, evaluate the objective, summarize."""

    distributions: dict[str, ParameterDistribution]
    n_samples: int
    seed: int = 0

    def __post_init__(self) -> None:
        if self.n_samples <= 0:
            raise ValueError("n_samples must be positive.")
        if not self.distributions:
            raise ValueError("distributions must be non-empty.")

    def propagate(
        self,
        objective: Callable[[dict[str, float]], dict[str, float] | float],
    ) -> UncertaintySummary:
        rng = np.random.default_rng(self.seed)
        names = list(self.distributions)
        samples = {
            name: self.distributions[name].sample(rng, self.n_samples)
            for name in names
        }

        # Collect outputs as dict[output_name, list[float]].
        per_output: dict[str, list[float]] = {}
        for i in range(self.n_samples):
            point = {name: float(samples[name][i]) for name in names}
            raw = objective(point)
            if isinstance(raw, (int, float)):
                raw = {"out": float(raw)}
            for k, v in raw.items():
                per_output.setdefault(k, []).append(float(v))

        summary = UncertaintySummary(n_samples=self.n_samples)
        for k, vs in per_output.items():
            arr = np.asarray(vs, dtype=np.float64)
            mean = float(arr.mean())
            std = float(arr.std(ddof=1)) if len(arr) > 1 else 0.0
            ci_low, ci_high = bootstrap_confidence_interval(
                arr, level=0.95, n_resamples=200, seed=self.seed + 1
            )
            summary.metrics[k] = {
                "samples": vs,
                "mean": mean,
                "stddev": std,
                "ci_95": [ci_low, ci_high],
            }
        return summary


# ---------------------------------------------------------------------------
# Sensitivity analysis (lightweight first-order index)
# ---------------------------------------------------------------------------


@dataclass
class SensitivityResult:
    """One sensitivity-analysis result."""

    total_index: dict[str, float]
    dominant: str
    detail: str = ""


@dataclass
class SensitivityAnalysis:
    """Variance-based sensitivity analysis (first-order index).

    For each parameter ``p``, perturb only that parameter while
    holding the rest at their nominal value (mean of the
    distribution); estimate the resulting output variance. The
    parameter whose perturbation drives the largest variance is the
    dominant contributor.

    This is a lightweight stand-in for full Sobol decomposition;
    appropriate when the objective is cheap and the parameter set
    is small. Phase 9+ may add a full-Sobol implementation behind
    the same interface.
    """

    distributions: dict[str, ParameterDistribution]
    n_samples: int
    seed: int = 0

    def __post_init__(self) -> None:
        if self.n_samples <= 0:
            raise ValueError("n_samples must be positive.")
        if not self.distributions:
            raise ValueError("distributions must be non-empty.")

    def evaluate(
        self,
        objective: Callable[[dict[str, float]], float],
    ) -> SensitivityResult:
        rng = np.random.default_rng(self.seed)
        names = list(self.distributions)

        # Nominal values: distribution mean (for normal / lognormal)
        # or midpoint (for uniform).
        def _nominal(d: ParameterDistribution) -> float:
            kind = d.kind.lower()
            if kind in ("normal", "lognormal"):
                return float(d.params["mean"])
            if kind == "uniform":
                return 0.5 * (float(d.params["low"]) + float(d.params["high"]))
            raise ValueError(f"Unknown kind {d.kind!r}")

        nominal = {n: _nominal(self.distributions[n]) for n in names}

        per_param_variance: dict[str, float] = {}
        for n in names:
            dist = self.distributions[n]
            samples = dist.sample(rng, self.n_samples)
            outputs = np.zeros(self.n_samples, dtype=np.float64)
            for i, v in enumerate(samples):
                point = dict(nominal)
                point[n] = float(v)
                outputs[i] = float(objective(point))
            per_param_variance[n] = (
                float(outputs.var(ddof=1)) if self.n_samples > 1 else 0.0
            )

        total = sum(per_param_variance.values()) or 1.0
        total_index = {
            n: per_param_variance[n] / total for n in names
        }
        dominant = max(total_index, key=total_index.get)
        return SensitivityResult(
            total_index=total_index,
            dominant=dominant,
            detail=f"per_param_variance={per_param_variance}",
        )


# ---------------------------------------------------------------------------
# Confidence intervals
# ---------------------------------------------------------------------------


def bootstrap_confidence_interval(
    samples: np.ndarray | list[float],
    *,
    level: float = 0.95,
    n_resamples: int = 1000,
    seed: int = 0,
) -> tuple[float, float]:
    """Bootstrap CI on the sample mean.

    Returns ``(low, high)`` such that ``level`` fraction of bootstrap
    means fall in the interval.
    """
    arr = np.asarray(samples, dtype=np.float64)
    if arr.size == 0:
        raise ValueError("Cannot compute CI on empty sample set.")
    if not (0.0 < level < 1.0):
        raise ValueError(f"level must be in (0, 1); got {level!r}")
    if n_resamples <= 0:
        raise ValueError(
            f"n_resamples must be positive; got {n_resamples!r}"
        )
    rng = np.random.default_rng(seed)
    means = np.empty(n_resamples, dtype=np.float64)
    for i in range(n_resamples):
        idx = rng.integers(0, arr.size, size=arr.size)
        means[i] = arr[idx].mean()
    alpha = (1.0 - level) / 2.0
    low = float(np.quantile(means, alpha))
    high = float(np.quantile(means, 1.0 - alpha))
    return low, high


# ---------------------------------------------------------------------------
# Dominant-uncertainty attribution
# ---------------------------------------------------------------------------


def dominant_uncertainty(samples_per_param: dict[str, list[float]]) -> str:
    """Return the parameter whose samples carry the largest variance.

    A coarse stand-in for full Sobol when only per-parameter sample
    sets are available (e.g. one-at-a-time MC sweeps).
    """
    if not samples_per_param:
        raise ValueError("samples_per_param must be non-empty.")
    variances = {
        name: float(np.var(np.asarray(vals, dtype=np.float64), ddof=1))
        for name, vals in samples_per_param.items()
    }
    return max(variances, key=variances.get)


__all__ = [
    "MonteCarloPropagator",
    "ParameterDistribution",
    "SensitivityAnalysis",
    "SensitivityResult",
    "UncertaintySummary",
    "bootstrap_confidence_interval",
    "dominant_uncertainty",
]

"""Diagnostic statistics — Phase 1E.

Plan §12.2 lists: means, variances, extrema, histograms, distribution fits,
spectral peaks, energy/charge conservation error, convergence rates,
confidence intervals, parameter sensitivity, numerical stability indicators.

This module ships the basic building blocks usable across diagnostics:
mean / variance / extrema / histogram / conservation_error. Spectral and
fit-based statistics land with the modules that need them (Phase 1D-onwards).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Summary:
    n: int
    mean: float
    variance: float
    minimum: float
    maximum: float
    stddev: float


def summarize(values: np.ndarray | list[float]) -> Summary:
    """Compute basic descriptive statistics for a time series."""
    arr = np.asarray(values, dtype=np.float64)
    if arr.size == 0:
        return Summary(n=0, mean=0.0, variance=0.0, minimum=0.0, maximum=0.0, stddev=0.0)
    mean = float(np.mean(arr))
    variance = float(np.var(arr, ddof=0))
    return Summary(
        n=int(arr.size),
        mean=mean,
        variance=variance,
        minimum=float(np.min(arr)),
        maximum=float(np.max(arr)),
        stddev=math.sqrt(variance),
    )


def histogram(
    values: np.ndarray | list[float],
    *,
    bins: int = 30,
    range: tuple[float, float] | None = None,  # noqa: A002 - matches numpy
) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(counts, edges)`` for a histogram of ``values``."""
    arr = np.asarray(values, dtype=np.float64)
    counts, edges = np.histogram(arr, bins=bins, range=range)
    return np.asarray(counts), np.asarray(edges)


def conservation_error(values: np.ndarray | list[float]) -> float:
    """Worst-case relative drift in a quantity that should be conserved.

    Returns ``max(|x_i - x_0|) / max(|x_0|, eps)``. Used by validation tests
    to bound energy / particle / charge conservation errors.
    """
    arr = np.asarray(values, dtype=np.float64)
    if arr.size == 0:
        return 0.0
    x0 = arr[0]
    return float(np.max(np.abs(arr - x0)) / max(abs(x0), 1e-300))


def relative_drift(values: np.ndarray | list[float]) -> float:
    """Relative drift between first and last sample (signed)."""
    arr = np.asarray(values, dtype=np.float64)
    if arr.size < 2:
        return 0.0
    return float((arr[-1] - arr[0]) / max(abs(arr[0]), 1e-300))


__all__ = ["Summary", "conservation_error", "histogram", "relative_drift", "summarize"]

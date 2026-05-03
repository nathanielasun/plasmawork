"""Phase 1E — Diagnostic statistics tests."""

from __future__ import annotations

import math

import numpy as np
import pytest
from simworkbench.diagnostics import (
    conservation_error,
    histogram,
    relative_drift,
    summarize,
)


def test_summarize_known_distribution():
    s = summarize([1.0, 2.0, 3.0, 4.0, 5.0])
    assert s.n == 5
    assert s.mean == pytest.approx(3.0)
    # Population variance: ((1-3)^2 + (2-3)^2 + 0 + 1 + 4) / 5 = 2.0
    assert s.variance == pytest.approx(2.0)
    assert s.minimum == 1.0
    assert s.maximum == 5.0
    assert s.stddev == pytest.approx(math.sqrt(2.0))


def test_summarize_empty():
    s = summarize([])
    assert s.n == 0
    assert s.mean == 0.0
    assert s.stddev == 0.0


def test_histogram_uniform():
    rng = np.random.default_rng(0)
    samples = rng.uniform(0, 1, size=10000)
    counts, edges = histogram(samples, bins=10, range=(0, 1))
    assert counts.shape == (10,)
    assert edges.shape == (11,)
    # Each bin should have approximately 1000 samples.
    assert all(700 <= c <= 1300 for c in counts)


def test_conservation_error_zero_for_constant_series():
    assert conservation_error([42.0, 42.0, 42.0]) == 0.0


def test_conservation_error_picks_worst_drift():
    # First sample 1.0; max deviation is at index 2 (1.5 - 1 = 0.5 = 50% of 1).
    assert conservation_error([1.0, 1.1, 1.5, 0.9]) == pytest.approx(0.5)


def test_relative_drift_endpoint_difference():
    assert relative_drift([1.0, 2.0, 3.0]) == pytest.approx(2.0)
    assert relative_drift([1.0, 1.0]) == pytest.approx(0.0)
    assert relative_drift([1.0]) == 0.0


def test_relative_drift_empty():
    assert relative_drift([]) == 0.0

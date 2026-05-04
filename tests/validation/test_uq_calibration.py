"""Phase 9 / 9C — Uncertainty quantification calibration tests.

The calibration tests verify that the UQ pipeline reproduces known
analytical answers within statistical tolerance:
  - Linear function: output mean / stddev / CI match closed form.
  - Quadratic: variance scaling with input stddev follows analytic.
  - Mixed-distribution propagation handles uniform + normal jointly.
  - Sensitivity analysis recovers the dominant contributor for a
    function whose variance is mostly driven by one parameter.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from simworkbench.uncertainty import (
    MonteCarloPropagator,
    ParameterDistribution,
    SensitivityAnalysis,
    bootstrap_confidence_interval,
    dominant_uncertainty,
)


def test_linear_propagation_matches_closed_form():
    """f(x) = a*x + b with x ~ N(mu, sigma); output ~ N(a*mu + b, |a|*sigma)."""
    a, b = 3.0, 5.0
    mu, sigma = 1.5, 0.2
    propagator = MonteCarloPropagator(
        distributions={
            "x": ParameterDistribution(
                kind="normal", params={"mean": mu, "stddev": sigma}
            ),
        },
        n_samples=4000,
        seed=0,
    )
    summary = propagator.propagate(lambda p: a * p["x"] + b)
    out = summary.metrics["out"]
    assert abs(out["mean"] - (a * mu + b)) < 0.05
    assert abs(out["stddev"] - abs(a) * sigma) < 0.05


def test_quadratic_variance_grows_with_input_stddev():
    """f(x) = x^2 with x ~ N(0, sigma); var(f) = 2*sigma^4."""
    results = {}
    for sigma in (0.1, 0.5, 1.0):
        propagator = MonteCarloPropagator(
            distributions={
                "x": ParameterDistribution(
                    kind="normal", params={"mean": 0.0, "stddev": sigma}
                ),
            },
            n_samples=4000,
            seed=0,
        )
        summary = propagator.propagate(lambda p: float(p["x"]) ** 2)
        results[sigma] = summary.metrics["out"]["stddev"]
    # The output stddev grows monotonically with input stddev.
    assert results[0.1] < results[0.5] < results[1.0]
    # Order-of-magnitude check: ratio of stddevs ~ ratio of sigmas^2.
    assert results[1.0] / results[0.1] > 50  # ratio of variances


def test_mixed_distribution_propagation():
    propagator = MonteCarloPropagator(
        distributions={
            "x": ParameterDistribution(
                kind="uniform", params={"low": 0.0, "high": 1.0}
            ),
            "y": ParameterDistribution(
                kind="normal", params={"mean": 2.0, "stddev": 0.5}
            ),
        },
        n_samples=2000,
        seed=0,
    )
    summary = propagator.propagate(lambda p: p["x"] + p["y"])
    out = summary.metrics["out"]
    # Uniform(0,1) mean = 0.5; Normal(2, 0.5) mean = 2; sum mean = 2.5.
    assert abs(out["mean"] - 2.5) < 0.1


def test_sensitivity_recovers_dominant_in_3_param_function():
    """f(x, y, z) = 0.1*x + y + 0.01*z; dominant contributor is y."""
    sens = SensitivityAnalysis(
        distributions={
            "x": ParameterDistribution(kind="uniform", params={"low": 0.0, "high": 1.0}),
            "y": ParameterDistribution(kind="uniform", params={"low": 0.0, "high": 1.0}),
            "z": ParameterDistribution(kind="uniform", params={"low": 0.0, "high": 1.0}),
        },
        n_samples=400,
        seed=0,
    )
    result = sens.evaluate(
        lambda p: 0.1 * p["x"] + p["y"] + 0.01 * p["z"]
    )
    assert result.dominant == "y"


def test_dominant_uncertainty_with_equal_inputs_picks_one():
    """When variances are equal, the function still returns one
    deterministic name (no NaN, no exception)."""
    rng = np.random.default_rng(0)
    samples = {
        "a": rng.normal(0.0, 1.0, size=200).tolist(),
        "b": rng.normal(0.0, 1.0, size=200).tolist(),
    }
    pick = dominant_uncertainty(samples)
    assert pick in {"a", "b"}


def test_bootstrap_ci_nominal_coverage():
    """A 95% bootstrap CI computed on i.i.d. normal draws covers the
    true mean approximately 95% of the time across replications."""
    rng = np.random.default_rng(0)
    covered = 0
    n_replications = 50
    for r in range(n_replications):
        samples = rng.normal(loc=2.0, scale=1.0, size=200)
        low, high = bootstrap_confidence_interval(
            samples, level=0.95, n_resamples=200, seed=r
        )
        if low <= 2.0 <= high:
            covered += 1
    # Stricter than 95% would be unstable with 50 reps; use a generous
    # bracket that still detects gross miscalibration.
    assert covered >= 35


def test_zero_n_samples_rejected():
    with pytest.raises(ValueError, match="n_samples must be positive"):
        MonteCarloPropagator(
            distributions={
                "x": ParameterDistribution(
                    kind="normal", params={"mean": 0.0, "stddev": 1.0}
                ),
            },
            n_samples=0,
            seed=0,
        )


def test_unknown_distribution_kind_rejected():
    rng = np.random.default_rng(0)
    with pytest.raises(ValueError, match="Unsupported"):
        ParameterDistribution(
            kind="cauchy", params={"location": 0.0, "scale": 1.0}
        ).sample(rng, n=10)


_ = math  # keep import used for future closed-form tests

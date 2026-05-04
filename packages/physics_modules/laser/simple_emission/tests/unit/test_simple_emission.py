from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
from simworkbench.units import Q

spec = importlib.util.spec_from_file_location(
    "phase7_simple_emission",
    Path(__file__).parents[2] / "src" / "__init__.py",
)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)

decay = module.decay


def test_decay_matches_first_order_closed_form():
    times = Q(np.array([0.0, 1.0, 2.0]), "second")
    result = decay(
        initial_excited_density=Q(10.0, "1 / meter ** 3"),
        lifetime=Q(2.0, "second"),
        time_grid=times,
    )

    expected = 10.0 * np.exp(-np.array([0.0, 1.0, 2.0]) / 2.0)
    np.testing.assert_allclose(
        result["excited_density_trajectory"].to("1 / meter ** 3").magnitude,
        expected,
    )
    np.testing.assert_allclose(
        result["photon_emission_rate"].to("1 / (meter ** 3 * second)").magnitude,
        expected / 2.0,
    )


def test_decay_rejects_non_positive_lifetime():
    with pytest.raises(ValueError, match="positive"):
        decay(
            initial_excited_density=Q(1.0, "1 / meter ** 3"),
            lifetime=Q(0.0, "second"),
            time_grid=Q(np.array([0.0]), "second"),
        )

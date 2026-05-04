from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q, magnitude

spec = importlib.util.spec_from_file_location(
    "phase7_simple_absorption",
    Path(__file__).parents[2] / "src" / "__init__.py",
)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)

absorb = module.absorb


def test_absorb_matches_lambert_beer_closed_form():
    result = absorb(
        incident_intensity=Q(2.0, "watt / meter ** 2"),
        absorber_density=Q(1.0e20, "1 / meter ** 3"),
        cross_section=Q(1.0e-22, "meter ** 2"),
        path_length=Q(0.5, "meter"),
    )

    expected_tau = 1.0e20 * 1.0e-22 * 0.5
    expected_transmitted = 2.0 * math.exp(-expected_tau)
    assert magnitude(result["transmitted_intensity"], "watt / meter ** 2") == pytest.approx(
        expected_transmitted
    )
    assert result["absorbed_fraction"] == pytest.approx(1.0 - math.exp(-expected_tau))
    assert magnitude(result["absorption_coefficient"], "1 / meter") == pytest.approx(1.0e-2)

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q, magnitude

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
spec = importlib.util.spec_from_file_location("_absorption_src", _SRC)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def test_absorption_coefficient_units_and_value():
    alpha = mod.absorption_coefficient(Q(2e-20, "meter ** 2"), Q(5e19, "1 / meter ** 3"))
    assert magnitude(alpha, "1 / meter") == pytest.approx(1.0)


def test_transmitted_intensity_uses_lambert_beer():
    intensity = mod.transmitted_intensity(
        Q(10.0, "watt / meter ** 2"),
        Q(2e-20, "meter ** 2"),
        Q(5e19, "1 / meter ** 3"),
        Q(1.0, "meter"),
    )
    assert magnitude(intensity, "watt / meter ** 2") == pytest.approx(10.0 / math.e)


def test_negative_inputs_rejected():
    with pytest.raises(ValueError):
        mod.absorption_coefficient(Q(-1.0, "meter ** 2"), Q(1.0, "1 / meter ** 3"))

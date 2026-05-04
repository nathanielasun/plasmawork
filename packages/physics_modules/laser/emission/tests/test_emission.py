from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q, magnitude

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
spec = importlib.util.spec_from_file_location("_emission_src", _SRC)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def test_emission_rate_units_and_value():
    rate = mod.emission_rate(Q(10.0, "1 / meter ** 3"), Q(2.0, "second"))
    assert magnitude(rate, "1 / (meter ** 3 * second)") == pytest.approx(5.0)


def test_exponential_decay():
    density = mod.excited_density_after_time(
        Q(10.0, "1 / meter ** 3"),
        Q(2.0, "second"),
        Q(2.0, "second"),
    )
    assert magnitude(density, "1 / meter ** 3") == pytest.approx(10.0 / math.e)


def test_lifetime_must_be_positive():
    with pytest.raises(ValueError):
        mod.emission_rate(Q(1.0, "1 / meter ** 3"), Q(0.0, "second"))

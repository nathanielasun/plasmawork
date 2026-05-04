from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q, magnitude

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
spec = importlib.util.spec_from_file_location("_recombination_src", _SRC)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def test_recombination_rate_value_and_units():
    rate = mod.recombination_rate(
        Q(2.0, "1 / meter ** 3"),
        Q(3.0, "1 / meter ** 3"),
        Q(4.0, "meter ** 3 / second"),
    )
    assert magnitude(rate, "1 / (meter ** 3 * second)") == pytest.approx(24.0)


def test_negative_coefficient_rejected():
    with pytest.raises(ValueError):
        mod.recombination_rate(
            Q(1.0, "1 / meter ** 3"),
            Q(1.0, "1 / meter ** 3"),
            Q(-1.0, "meter ** 3 / second"),
        )

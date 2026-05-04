from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q, magnitude

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
spec = importlib.util.spec_from_file_location("_electron_temperature_src", _SRC)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def test_round_trip_temperature_energy():
    energy = mod.mean_energy_from_temperature(Q(300.0, "kelvin"))
    temperature = mod.temperature_from_mean_energy(energy)
    assert magnitude(temperature, "kelvin") == pytest.approx(300.0)


def test_negative_energy_rejected():
    with pytest.raises(ValueError):
        mod.temperature_from_mean_energy(Q(-1.0, "joule"))

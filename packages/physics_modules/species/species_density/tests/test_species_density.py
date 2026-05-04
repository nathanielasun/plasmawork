from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q, magnitude

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
spec = importlib.util.spec_from_file_location("_species_density_src", _SRC)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def test_uniform_density_and_count_round_trip():
    density = mod.uniform_density(10.0, Q(2.0, "meter ** 3"))
    assert magnitude(density, "1 / meter ** 3") == pytest.approx(5.0)
    assert mod.total_particles(density, Q(2.0, "meter ** 3")) == pytest.approx(10.0)


def test_invalid_volume_rejected():
    with pytest.raises(ValueError):
        mod.uniform_density(1.0, Q(0.0, "meter ** 3"))

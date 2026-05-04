"""Phase 7C collisional-model unit tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q

_MODULE_ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "_coll_src", _MODULE_ROOT / "src" / "__init__.py"
)
assert spec is not None and spec.loader is not None
coll_mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = coll_mod
spec.loader.exec_module(coll_mod)
collision_frequency = coll_mod.collision_frequency
coulomb_log = coll_mod.coulomb_log


def test_coulomb_log_in_expected_range():
    Lambda = coulomb_log(
        electron_density=Q(1e18, "1 / meter ** 3"),
        electron_temperature=Q(1e6, "kelvin"),  # ~86 eV
    )
    assert 5.0 < Lambda < 30.0


def test_collision_frequency_units():
    nu = collision_frequency(
        electron_density=Q(1e18, "1 / meter ** 3"),
        electron_temperature=Q(1e6, "kelvin"),
    )
    assert nu.units == Q(1.0, "1 / second").units
    assert nu.magnitude > 0


def test_zero_temperature_raises():
    with pytest.raises(ValueError):
        coulomb_log(
            electron_density=Q(1e18, "1 / meter ** 3"),
            electron_temperature=Q(0.0, "kelvin"),
        )

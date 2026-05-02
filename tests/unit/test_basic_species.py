"""Phase 1D — Basic species tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from simworkbench.units import Q, UnitsError, magnitude

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "species"
    / "basic"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("basic_species", _MODULE_PATH)
assert _spec and _spec.loader
_basic = importlib.util.module_from_spec(_spec)
sys.modules["basic_species"] = _basic
_spec.loader.exec_module(_basic)


def test_atom_constructor():
    Kr = _basic.atom("Kr", mass=Q("83.798 amu"), initial_density=Q("1e22 1/m^3"))
    assert Kr.name == "Kr"
    assert Kr.kind == "atom"
    assert Kr.charge == 0
    assert magnitude(Kr.initial_density, "1/m^3") == pytest.approx(1e22)


def test_ion_requires_nonzero_charge():
    with pytest.raises(ValueError, match="non-zero"):
        _basic.ion("Kr+", mass=Q("83.798 amu"), charge=0, initial_density=Q("0 1/m^3"))


def test_electron_constructor():
    e = _basic.electron(initial_density=Q("1e18 1/m^3"))
    assert e.kind == "electron"
    assert e.charge == -1.0
    # rest mass ≈ 9.1e-31 kg
    assert magnitude(e.mass, "kilogram") == pytest.approx(9.1093837015e-31, rel=1e-9)


def test_rejects_non_integer_charge():
    with pytest.raises(ValueError, match="integer"):
        _basic.BasicSpecies(
            name="x", kind="ion", mass=Q("1 amu"), charge=0.5,
            initial_density=Q("0 1/m^3"),
        )


def test_rejects_wrong_density_units():
    with pytest.raises(UnitsError):
        _basic.atom("x", mass=Q("1 amu"), initial_density=Q("1 second"))


def test_rejects_wrong_mass_units():
    with pytest.raises(UnitsError):
        _basic.atom("x", mass=Q("1 second"), initial_density=Q("1 1/m^3"))

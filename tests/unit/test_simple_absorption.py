"""Phase 1D — simple_absorption (Beer-Lambert) tests."""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import pytest
from simworkbench.units import Q, UnitsError, magnitude

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "laser"
    / "simple_absorption"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("simple_absorption", _MODULE_PATH)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
sys.modules["simple_absorption"] = _mod
_spec.loader.exec_module(_mod)


def test_no_absorber_means_no_absorption():
    r = _mod.absorb(
        incident_intensity=Q("1.0e10 W/m^2"),
        absorber_density=Q("0 1/m^3"),
        cross_section=Q("1e-22 m^2"),
        path_length=Q("1 m"),
    )
    assert magnitude(r["transmitted_intensity"], "W/m^2") == pytest.approx(1.0e10)
    assert r["absorbed_fraction"] == pytest.approx(0.0)


def test_optically_thick_absorbs_almost_everything():
    r = _mod.absorb(
        incident_intensity=Q("1.0 W/m^2"),
        absorber_density=Q("1e23 1/m^3"),
        cross_section=Q("1e-20 m^2"),
        path_length=Q("1 m"),
    )
    # alpha*L = 1e23 * 1e-20 * 1 = 1000 → exp(-1000) ≈ 0
    assert magnitude(r["transmitted_intensity"], "W/m^2") < 1e-300
    assert r["absorbed_fraction"] == pytest.approx(1.0, abs=1e-12)


def test_alpha_matches_sigma_times_density():
    r = _mod.absorb(
        incident_intensity=Q("1.0 W/m^2"),
        absorber_density=Q("1e22 1/m^3"),
        cross_section=Q("3e-22 m^2"),
        path_length=Q("0.1 m"),
    )
    # alpha = 1e22 * 3e-22 = 3 1/m
    assert magnitude(r["absorption_coefficient"], "1/m") == pytest.approx(3.0)
    # exp(-3 * 0.1) = exp(-0.3)
    assert magnitude(r["transmitted_intensity"], "W/m^2") == pytest.approx(math.exp(-0.3))


def test_rejects_unit_mismatch_on_cross_section():
    with pytest.raises(UnitsError):
        _mod.absorb(
            incident_intensity=Q("1.0 W/m^2"),
            absorber_density=Q("1e22 1/m^3"),
            cross_section=Q("3 second"),
            path_length=Q("1 m"),
        )


def test_rejects_raw_float():
    with pytest.raises(UnitsError):
        _mod.absorb(
            incident_intensity=1.0,  # type: ignore[arg-type]
            absorber_density=Q("1e22 1/m^3"),
            cross_section=Q("3e-22 m^2"),
            path_length=Q("1 m"),
        )

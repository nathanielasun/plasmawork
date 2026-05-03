"""Phase 1D — simple_emission tests."""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
import pytest
from simworkbench.units import Q, UnitsError, magnitude

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "laser"
    / "simple_emission"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("simple_emission", _MODULE_PATH)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
sys.modules["simple_emission"] = _mod
_spec.loader.exec_module(_mod)


def test_initial_density_at_t_zero():
    ts = np.array([0.0, 1e-9, 2e-9])
    r = _mod.decay(
        initial_excited_density=Q("1e18 1/m^3"),
        lifetime=Q("10 ns"),
        time_grid=Q(ts, "second"),
    )
    n = magnitude(r["excited_density_trajectory"], "1/m^3")
    assert n[0] == pytest.approx(1e18)


def test_decay_to_one_e_at_lifetime():
    tau = 10e-9
    ts = np.array([tau])
    r = _mod.decay(
        initial_excited_density=Q("1e18 1/m^3"),
        lifetime=Q(tau, "second"),
        time_grid=Q(ts, "second"),
    )
    n = magnitude(r["excited_density_trajectory"], "1/m^3")
    assert n[0] == pytest.approx(1e18 / math.e, rel=1e-9)


def test_emission_rate_equals_density_over_lifetime():
    tau = 5e-9
    ts = np.array([0.0, tau, 2 * tau])
    r = _mod.decay(
        initial_excited_density=Q("1e18 1/m^3"),
        lifetime=Q(tau, "second"),
        time_grid=Q(ts, "second"),
    )
    n = magnitude(r["excited_density_trajectory"], "1/m^3")
    rate = magnitude(r["photon_emission_rate"], "1/(m^3 s)")
    np.testing.assert_allclose(rate, n / tau, rtol=1e-12)


def test_rejects_zero_lifetime():
    with pytest.raises(ValueError, match="positive"):
        _mod.decay(
            initial_excited_density=Q("1e18 1/m^3"),
            lifetime=Q("0 ns"),
            time_grid=Q(np.array([0.0]), "second"),
        )


def test_rejects_unit_mismatch_on_lifetime():
    with pytest.raises(UnitsError):
        _mod.decay(
            initial_excited_density=Q("1e18 1/m^3"),
            lifetime=Q("10 meter"),  # wrong dimension
            time_grid=Q(np.array([0.0]), "second"),
        )

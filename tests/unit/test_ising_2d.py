"""Phase 1D — 2D Ising tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "phase_transition"
    / "ising_2d"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("ising_2d", _MODULE_PATH)
assert _spec and _spec.loader
_ising = importlib.util.module_from_spec(_spec)
sys.modules["ising_2d"] = _ising
_spec.loader.exec_module(_ising)


def test_low_temperature_is_ordered():
    """At T* << T_c, |m| should be very close to 1."""
    r = _ising.simulate(
        lattice_size=8, temperature_reduced=1.0,
        n_sweeps=200, equilibration_sweeps=200, seed=0,
    )
    assert r["magnetization_per_spin"] > 0.95


def test_high_temperature_is_disordered():
    """At T* >> T_c, |m| should be small (paramagnetic)."""
    r = _ising.simulate(
        lattice_size=8, temperature_reduced=5.0,
        n_sweeps=400, equilibration_sweeps=400, seed=0,
    )
    assert r["magnetization_per_spin"] < 0.3


def test_lattice_size_validates():
    with pytest.raises(ValueError, match="lattice_size"):
        _ising.simulate(lattice_size=0, temperature_reduced=1.0, n_sweeps=10)


def test_temperature_validates():
    with pytest.raises(ValueError, match="temperature_reduced"):
        _ising.simulate(lattice_size=4, temperature_reduced=0, n_sweeps=10)


def test_n_sweeps_validates():
    with pytest.raises(ValueError, match="n_sweeps"):
        _ising.simulate(lattice_size=4, temperature_reduced=1.0, n_sweeps=0)


def test_seed_reproducibility():
    a = _ising.simulate(
        lattice_size=8, temperature_reduced=2.0, n_sweeps=50,
        equilibration_sweeps=50, seed=42,
    )
    b = _ising.simulate(
        lattice_size=8, temperature_reduced=2.0, n_sweeps=50,
        equilibration_sweeps=50, seed=42,
    )
    np.testing.assert_array_equal(a["final_spins"], b["final_spins"])
    assert a["magnetization_per_spin"] == b["magnetization_per_spin"]


def test_external_field_biases_magnetization():
    r_pos = _ising.simulate(
        lattice_size=6, temperature_reduced=4.0,
        n_sweeps=400, equilibration_sweeps=200, external_field=0.5, seed=0,
    )
    r_neg = _ising.simulate(
        lattice_size=6, temperature_reduced=4.0,
        n_sweeps=400, equilibration_sweeps=200, external_field=-0.5, seed=0,
    )
    # |m| measures only magnitude; check magnetization_trace mean instead.
    pos_mean = float(np.mean(r_pos["magnetization_trace"]))
    neg_mean = float(np.mean(r_neg["magnetization_trace"]))
    assert pos_mean > 0
    assert neg_mean < 0

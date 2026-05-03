"""Phase 1D — Lennard-Jones MD tests."""

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
    / "molecular_dynamics"
    / "lennard_jones"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("lennard_jones", _MODULE_PATH)
assert _spec and _spec.loader
_lj = importlib.util.module_from_spec(_spec)
sys.modules["lennard_jones"] = _lj
_spec.loader.exec_module(_lj)


def _run_short(n_steps: int = 50, n_particles: int = 16, **kwargs) -> dict:
    return _lj.simulate(
        n_particles=n_particles,
        box_size=Q("1.7 nm"),
        temperature=Q("100 K"),
        epsilon=Q(1.66e-21, "J"),
        sigma=Q("0.34 nm"),
        mass=Q("39.948 amu"),
        n_steps=n_steps,
        dt=Q("4 fs"),
        **kwargs,
    )


def test_simulate_returns_expected_arrays():
    r = _run_short()
    pos = magnitude(r["trajectory_positions"], "meter")
    assert pos.shape == (51, 16, 2)
    e = magnitude(r["trajectory_total_energy"], "joule")
    assert e.shape == (51,)


def test_kinetic_plus_potential_equals_total():
    r = _run_short()
    ke = magnitude(r["trajectory_kinetic_energy"], "joule")
    pe = magnitude(r["trajectory_potential_energy"], "joule")
    e = magnitude(r["trajectory_total_energy"], "joule")
    import numpy as np
    np.testing.assert_allclose(ke + pe, e, rtol=1e-12)


def test_energy_drift_small_for_short_run():
    r = _run_short(n_steps=100)
    # Velocity Verlet preserves energy to ~O((dt)^2). Should be < 1% over 100 steps.
    assert r["energy_drift_relative"] < 1e-2


def test_seed_reproducibility():
    r1 = _run_short(seed=7)
    r2 = _run_short(seed=7)
    e1 = magnitude(r1["trajectory_total_energy"], "joule")
    e2 = magnitude(r2["trajectory_total_energy"], "joule")
    import numpy as np
    np.testing.assert_array_equal(e1, e2)


def test_rejects_unit_mismatch():
    with pytest.raises(UnitsError):
        _lj.simulate(
            n_particles=4, box_size=Q("1 nm"),
            temperature=Q("100 second"),  # wrong dim
            epsilon=Q(1.66e-21, "J"), sigma=Q("0.34 nm"), mass=Q("40 amu"),
            n_steps=10, dt=Q("1 fs"),
        )


def test_rejects_zero_particles():
    with pytest.raises(ValueError, match="n_particles"):
        _lj.simulate(
            n_particles=0, box_size=Q("1 nm"), temperature=Q("100 K"),
            epsilon=Q(1.66e-21, "J"), sigma=Q("0.34 nm"), mass=Q("40 amu"),
            n_steps=10, dt=Q("1 fs"),
        )

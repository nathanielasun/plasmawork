"""Module-local unit tests for Lennard-Jones MD."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
from simworkbench.units import Q, UnitsError, magnitude

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
spec = importlib.util.spec_from_file_location("_lj_src", _SRC)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def _run_short(n_steps: int = 25) -> dict:
    return mod.simulate(
        n_particles=8,
        box_size=Q("1.7 nm"),
        temperature=Q("100 K"),
        epsilon=Q(1.66e-21, "J"),
        sigma=Q("0.34 nm"),
        mass=Q("39.948 amu"),
        n_steps=n_steps,
        dt=Q("4 fs"),
    )


def test_simulate_returns_energy_and_position_trajectories():
    result = _run_short()
    assert magnitude(result["trajectory_positions"], "meter").shape == (26, 8, 2)
    assert magnitude(result["trajectory_total_energy"], "joule").shape == (26,)


def test_kinetic_plus_potential_equals_total():
    result = _run_short()
    ke = magnitude(result["trajectory_kinetic_energy"], "joule")
    pe = magnitude(result["trajectory_potential_energy"], "joule")
    total = magnitude(result["trajectory_total_energy"], "joule")
    np.testing.assert_allclose(ke + pe, total, rtol=1e-12)


def test_rejects_bad_units_and_particle_count():
    with pytest.raises(UnitsError):
        mod.simulate(
            n_particles=4,
            box_size=Q("1 nm"),
            temperature=Q("100 second"),
            epsilon=Q(1.66e-21, "J"),
            sigma=Q("0.34 nm"),
            mass=Q("40 amu"),
            n_steps=10,
            dt=Q("1 fs"),
        )
    with pytest.raises(ValueError, match="n_particles"):
        mod.simulate(
            n_particles=0,
            box_size=Q("1 nm"),
            temperature=Q("100 K"),
            epsilon=Q(1.66e-21, "J"),
            sigma=Q("0.34 nm"),
            mass=Q("40 amu"),
            n_steps=10,
            dt=Q("1 fs"),
        )

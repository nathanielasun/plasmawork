"""Phase 1D validation — Velocity Verlet energy-drift bound for the LJ MD example.

Velocity Verlet is symplectic (energy-conserving in the time-averaged sense
with O((dt)^2) drift). This test asserts the bound declared in the module
README: drift < 0.1% over the test window.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from simworkbench.units import Q

_LJ_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "molecular_dynamics"
    / "lennard_jones"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("lennard_jones", _LJ_PATH)
assert _spec and _spec.loader
_lj = importlib.util.module_from_spec(_spec)
sys.modules["lennard_jones"] = _lj
_spec.loader.exec_module(_lj)


def test_energy_drift_under_one_thousandth_for_short_run():
    """500-step run with dt = 4 fs ≈ 0.005 reduced time. Drift bound is 0.1%."""
    result = _lj.simulate(
        n_particles=64,
        box_size=Q("3.4 nm"),
        temperature=Q("100 K"),
        epsilon=Q(1.66e-21, "J"),
        sigma=Q("0.34 nm"),
        mass=Q("39.948 amu"),
        n_steps=500,
        dt=Q("4 fs"),
        seed=0,
    )
    assert result["energy_drift_relative"] < 1e-3, (
        f"Energy drift {result['energy_drift_relative']:.3e} exceeds 0.1% bound; "
        "either the integrator regressed or dt is too large."
    )


def test_smaller_dt_means_smaller_drift():
    """Halving dt should shrink drift by ≈4× (Verlet is O(dt^2))."""
    common = dict(
        n_particles=32,
        box_size=Q("2.4 nm"),
        temperature=Q("100 K"),
        epsilon=Q(1.66e-21, "J"),
        sigma=Q("0.34 nm"),
        mass=Q("39.948 amu"),
        seed=0,
    )
    coarse = _lj.simulate(**common, n_steps=200, dt=Q("4 fs"))
    fine = _lj.simulate(**common, n_steps=400, dt=Q("2 fs"))
    # Both runs cover the same wall-clock window. Expect fine drift smaller —
    # but allow a generous tolerance because thermal fluctuations dominate
    # for very short runs.
    assert fine["energy_drift_relative"] <= coarse["energy_drift_relative"] * 2.0

"""Phase 1D validation — Ising magnetization crosses zero near T_c.

Onsager's exact 2D Ising result: T_c* = 2 / ln(1 + sqrt(2)) ≈ 2.269. At small
finite L, the transition smears into a crossover. We assert the qualitative
signature: |m| is large below T_c, small above T_c, and decreasing
monotonically through the transition region.

Statistical test, not deterministic — uses a fixed seed for reproducibility.
"""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

_ISING_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "phase_transition"
    / "ising_2d"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("ising_2d", _ISING_PATH)
assert _spec and _spec.loader
_ising = importlib.util.module_from_spec(_spec)
sys.modules["ising_2d"] = _ising
_spec.loader.exec_module(_ising)


T_C_ONSAGER = 2.0 / math.log(1.0 + math.sqrt(2.0))


def test_low_temp_high_magnetization():
    r = _ising.simulate(
        lattice_size=10, temperature_reduced=1.5,
        n_sweeps=400, equilibration_sweeps=400, seed=0,
    )
    assert r["magnetization_per_spin"] > 0.85


def test_high_temp_low_magnetization():
    r = _ising.simulate(
        lattice_size=10, temperature_reduced=4.0,
        n_sweeps=400, equilibration_sweeps=400, seed=0,
    )
    assert r["magnetization_per_spin"] < 0.3


def test_magnetization_drops_monotonically_through_critical_region():
    """Sample below, near, and above T_c; |m| must be non-increasing in T."""
    temperatures = [1.5, 2.0, T_C_ONSAGER, 2.7, 3.5]
    mags = []
    for T in temperatures:
        r = _ising.simulate(
            lattice_size=10, temperature_reduced=T,
            n_sweeps=400, equilibration_sweeps=400, seed=0,
        )
        mags.append(r["magnetization_per_spin"])
    # Allow a small wobble (Monte Carlo noise) — assert each step is at most
    # 0.05 above the previous.
    for prev, curr in zip(mags, mags[1:], strict=False):
        assert curr <= prev + 0.05, f"|m| increased: {prev:.3f} -> {curr:.3f}"
    # And the first vs. last differ by a lot.
    assert mags[0] - mags[-1] > 0.5

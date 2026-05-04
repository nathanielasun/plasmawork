"""Wave equation 1D — unit tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
from simworkbench.units import Q

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
spec = importlib.util.spec_from_file_location("_wave_src", _SRC)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def test_cfl_violation_raises():
    with pytest.raises(ValueError, match="CFL"):
        mod.simulate(
            domain_length=Q(1.0, "meter"),
            wave_speed=Q(1.0, "meter / second"),
            grid_resolution=Q(0.1, "meter"),
            dt=Q(0.2, "second"),  # CFL = 2 > 1
            n_steps=10,
            initial_displacement=np.zeros_like,
        )


def test_zero_initial_condition_stays_zero():
    result = mod.simulate(
        domain_length=Q(1.0, "meter"),
        wave_speed=Q(1.0, "meter / second"),
        grid_resolution=Q(0.05, "meter"),
        dt=Q(0.01, "second"),
        n_steps=20,
        initial_displacement=np.zeros_like,
    )
    assert np.max(np.abs(result["trajectory"])) < 1e-12


def test_dirichlet_bc_enforced():
    result = mod.simulate(
        domain_length=Q(1.0, "meter"),
        wave_speed=Q(1.0, "meter / second"),
        grid_resolution=Q(0.05, "meter"),
        dt=Q(0.01, "second"),
        n_steps=10,
        initial_displacement=lambda x: np.sin(np.pi * x),
    )
    # Boundary nodes stay at exactly zero.
    assert np.max(np.abs(result["trajectory"][:, 0])) < 1e-12
    assert np.max(np.abs(result["trajectory"][:, -1])) < 1e-12

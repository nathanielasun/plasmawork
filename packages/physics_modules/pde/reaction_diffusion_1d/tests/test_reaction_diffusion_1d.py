"""Reaction-diffusion 1D — unit tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
from simworkbench.units import Q

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
spec = importlib.util.spec_from_file_location("_rd_src", _SRC)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def test_zero_initial_condition_stays_zero():
    result = mod.simulate(
        domain_length=Q(1.0, "meter"),
        diffusion_coefficient=Q(1.0, "meter ** 2 / second"),
        reaction_rate=Q(0.0, "1 / second"),
        grid_resolution=Q(0.05, "meter"),
        dt=Q(0.001, "second"),
        n_steps=10,
        initial_condition=np.zeros_like,
    )
    assert np.max(np.abs(result["trajectory"])) < 1e-12


def test_dirichlet_bc_enforced():
    result = mod.simulate(
        domain_length=Q(1.0, "meter"),
        diffusion_coefficient=Q(1.0, "meter ** 2 / second"),
        reaction_rate=Q(0.0, "1 / second"),
        grid_resolution=Q(0.05, "meter"),
        dt=Q(0.001, "second"),
        n_steps=10,
        initial_condition=lambda x: np.sin(np.pi * x),
    )
    assert np.max(np.abs(result["trajectory"][:, 0])) < 1e-12
    assert np.max(np.abs(result["trajectory"][:, -1])) < 1e-12


def test_invalid_n_steps_raises():
    with pytest.raises(ValueError):
        mod.simulate(
            domain_length=Q(1.0, "meter"),
            diffusion_coefficient=Q(1.0, "meter ** 2 / second"),
            reaction_rate=Q(0.0, "1 / second"),
            grid_resolution=Q(0.05, "meter"),
            dt=Q(0.001, "second"),
            n_steps=0,
            initial_condition=np.zeros_like,
        )

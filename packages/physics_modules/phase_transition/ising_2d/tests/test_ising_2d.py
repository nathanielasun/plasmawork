"""Module-local unit tests for the 2D Ising module."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
spec = importlib.util.spec_from_file_location("_ising_src", _SRC)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def test_seed_reproducibility():
    a = mod.simulate(
        lattice_size=8,
        temperature_reduced=2.0,
        n_sweeps=40,
        equilibration_sweeps=20,
        seed=42,
    )
    b = mod.simulate(
        lattice_size=8,
        temperature_reduced=2.0,
        n_sweeps=40,
        equilibration_sweeps=20,
        seed=42,
    )
    np.testing.assert_array_equal(a["final_spins"], b["final_spins"])
    assert a["magnetization_per_spin"] == b["magnetization_per_spin"]


def test_input_validation():
    with pytest.raises(ValueError, match="lattice_size"):
        mod.simulate(lattice_size=0, temperature_reduced=1.0, n_sweeps=10)
    with pytest.raises(ValueError, match="temperature_reduced"):
        mod.simulate(lattice_size=4, temperature_reduced=0, n_sweeps=10)
    with pytest.raises(ValueError, match="n_sweeps"):
        mod.simulate(lattice_size=4, temperature_reduced=1.0, n_sweeps=0)

"""Lennard-Jones MD — energy conservation benchmark.

Verlet preserves total energy in a microcanonical ensemble; this
benchmark runs a small N=8 system for 200 steps and asserts
total-energy drift < 1% relative.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from simworkbench.units import Q
from simworkbench.validation_library import ConservationCheck, ValidationReport

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
_spec = importlib.util.spec_from_file_location("_lj_src", _SRC)
assert _spec is not None and _spec.loader is not None
_lj = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _lj
_spec.loader.exec_module(_lj)


def run_benchmark() -> ValidationReport:
    result = _lj.simulate(
        n_particles=8,
        box_size=Q(8 * 3.4e-10, "meter"),  # 8 sigma
        temperature=Q(120.0, "kelvin"),  # T* ~ 1.0 for argon-like
        epsilon=Q(1.65e-21, "joule"),  # argon-like epsilon
        sigma=Q(3.4e-10, "meter"),  # argon-like sigma
        mass=Q(6.63e-26, "kilogram"),  # argon-like mass
        n_steps=200,
        dt=Q(5e-15, "second"),
        seed=0,
    )
    e_total = result["trajectory_total_energy"].magnitude
    check = ConservationCheck(
        name="lj_total_energy",
        quantity_series=lambda _: list(e_total),
        tolerance_relative=0.01,
    )
    return check.evaluate(None)


__all__ = ["run_benchmark"]

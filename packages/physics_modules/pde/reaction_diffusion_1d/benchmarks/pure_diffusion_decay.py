"""Reaction-diffusion 1D — pure-diffusion decay of a Fourier mode."""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
from simworkbench.units import Q
from simworkbench.validation_library import ValidationReport

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
_spec = importlib.util.spec_from_file_location("_rd_src", _SRC)
assert _spec is not None and _spec.loader is not None
_rd = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _rd
_spec.loader.exec_module(_rd)


def run_benchmark() -> ValidationReport:
    L = 1.0
    D = 1.0
    nx = 51
    dx = L / (nx - 1)
    diffusion_time = L * L / D
    dt = 0.01 * diffusion_time
    n_steps = int(round(diffusion_time / dt))

    result = _rd.simulate(
        domain_length=Q(L, "meter"),
        diffusion_coefficient=Q(D, "meter ** 2 / second"),
        reaction_rate=Q(0.0, "1 / second"),
        grid_resolution=Q(dx, "meter"),
        dt=Q(dt, "second"),
        n_steps=n_steps,
        initial_condition=lambda x: np.sin(math.pi * x / L),
    )
    final = result["trajectory"][-1]
    x = result["x_meters"]
    final_time = result["time_seconds"][-1]
    expected = np.sin(math.pi * x / L) * math.exp(-D * math.pi**2 * final_time / (L * L))
    err = float(np.linalg.norm(final - expected) / max(np.linalg.norm(expected), 1e-30))
    passed = err < 0.01
    return ValidationReport(
        name="pure_diffusion_decay",
        passed=passed,
        metric=err,
        tolerance=0.01,
        detail=f"L2 relative error after one diffusion time = {err:.3e}",
        metadata={"reference": "Closed-form Fourier-mode decay"},
    )


__all__ = ["run_benchmark"]

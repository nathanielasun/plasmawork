"""Wave equation 1D — standing wave period benchmark."""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
from simworkbench.units import Q
from simworkbench.validation_library import ValidationReport

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
_spec = importlib.util.spec_from_file_location("_wave_src", _SRC)
assert _spec is not None and _spec.loader is not None
_wave = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _wave
_spec.loader.exec_module(_wave)


def run_benchmark() -> ValidationReport:
    L = 1.0
    c = 1.0
    nx = 51
    dx = L / (nx - 1)
    cfl = 0.9
    dt = cfl * dx / c
    period = 2 * L / c
    n_steps = int(round(period / dt))

    result = _wave.simulate(
        domain_length=Q(L, "meter"),
        wave_speed=Q(c, "meter / second"),
        grid_resolution=Q(dx, "meter"),
        dt=Q(dt, "second"),
        n_steps=n_steps,
        initial_displacement=lambda x: np.sin(math.pi * x / L),
    )
    final = result["trajectory"][-1]
    initial = result["trajectory"][0]
    err = float(np.linalg.norm(final - initial) / max(np.linalg.norm(initial), 1e-30))
    passed = err < 0.05
    return ValidationReport(
        name="standing_wave_period",
        passed=passed,
        metric=err,
        tolerance=0.05,
        detail=f"L2 relative error after one period = {err:.3e}",
        metadata={"reference": "Standing-wave closed form"},
    )


__all__ = ["run_benchmark"]

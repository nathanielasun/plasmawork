"""Ising 2D — low-temperature ferromagnetic regime."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from simworkbench.validation_library import ValidationReport

_SRC = Path(__file__).resolve().parent.parent / "src" / "__init__.py"
_spec = importlib.util.spec_from_file_location("_ising_src", _SRC)
assert _spec is not None and _spec.loader is not None
_ising = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _ising
_spec.loader.exec_module(_ising)


def run_benchmark() -> ValidationReport:
    result = _ising.simulate(
        lattice_size=8,
        temperature_reduced=1.0,
        n_sweeps=1000,
        equilibration_sweeps=500,
        external_field=0.0,
        seed=0,
    )
    m = float(result["magnetization_per_spin"])
    passed = abs(m) > 0.95
    return ValidationReport(
        name="ising_low_temperature_ferromagnetic",
        passed=passed,
        metric=abs(m),
        tolerance=0.95,
        detail=f"|m|={abs(m):.4f} (expect > 0.95 at T*=1.0)",
        metadata={"reference": "Ising 2D ferromagnetic phase"},
    )


__all__ = ["run_benchmark"]

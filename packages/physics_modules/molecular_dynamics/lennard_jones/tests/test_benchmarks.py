"""Phase 7 — gate-walk benchmark for lennard_jones."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_BENCH = (
    Path(__file__).resolve().parent.parent / "benchmarks" / "energy_conservation.py"
)
spec = importlib.util.spec_from_file_location("_lj_bench", _BENCH)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def test_lj_energy_conservation():
    report = mod.run_benchmark()
    assert report.passed, report.detail

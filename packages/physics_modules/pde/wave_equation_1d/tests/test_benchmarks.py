"""Phase 7 — wave_equation_1d benchmark."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load(name: str):
    path = Path(__file__).resolve().parent.parent / "benchmarks" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"_b_{name}", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_standing_wave_period():
    bench = _load("standing_wave_period")
    report = bench.run_benchmark()
    assert report.passed, report.detail

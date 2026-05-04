"""Phase 7 — Ising 2D benchmarks."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_benchmark(name: str):
    path = Path(__file__).resolve().parent.parent / "benchmarks" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"_bench_{name}", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_low_temperature_ferromagnetic():
    bench = _load_benchmark("low_temperature_ferromagnetic")
    report = bench.run_benchmark()
    assert report.passed, report.detail


def test_high_temperature_paramagnetic():
    bench = _load_benchmark("high_temperature_paramagnetic")
    report = bench.run_benchmark()
    assert report.passed, report.detail

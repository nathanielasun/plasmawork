"""Phase 7 — gate-walk benchmarks for rate_equation_0d."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_MODULE_ROOT = Path(__file__).resolve().parent.parent


def _load_benchmark(name: str):
    """Load a sibling benchmark file without requiring a Python package
    rooted at packages/physics_modules/. Each benchmark exports
    ``run_benchmark()``."""
    spec = importlib.util.spec_from_file_location(
        f"_bench_{name}",
        _MODULE_ROOT / "benchmarks" / f"{name}.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_first_order_decay_matches_analytic():
    bench = _load_benchmark("first_order_decay")
    report = bench.run_benchmark()
    assert report.passed, report.detail


def test_a_to_b_conserves_total_density():
    bench = _load_benchmark("two_species_conversion")
    report = bench.run_benchmark()
    assert report.passed, report.detail

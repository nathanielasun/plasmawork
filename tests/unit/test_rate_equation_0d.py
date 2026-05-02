"""Phase 1D — rate_equation_0d driver tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "physics_modules"
    / "species"
    / "rate_equation_0d"
    / "src"
    / "__init__.py"
)
_spec = importlib.util.spec_from_file_location("rate_equation_0d", _MODULE_PATH)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
sys.modules["rate_equation_0d"] = _mod
_spec.loader.exec_module(_mod)


def _example_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )


def _experiment(max_steps: int = 50) -> Experiment:
    return Experiment.from_model_spec(
        load_yaml(_example_path()),
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=max_steps),
    )


def test_simulate_completes_with_expected_diagnostics():
    result = _mod.simulate(_experiment(max_steps=20))
    assert "A" in result.diagnostics
    assert "B" in result.diagnostics
    assert "time_seconds" in result.diagnostics
    assert len(result.diagnostics["A"]) == 20


def test_simulate_conserves_total_density():
    result = _mod.simulate(_experiment(max_steps=20))
    A0 = result.diagnostics["A"][0]
    B0 = result.diagnostics["B"][0]
    A_final = result.diagnostics["A"][-1]
    B_final = result.diagnostics["B"][-1]
    initial = A0 + B0
    final = A_final + B_final
    assert final == pytest.approx(initial, rel=1e-6)


def test_simulate_rejects_non_0d():
    # Build a 1D ModelSpec from the example YAML.
    import yaml as _yaml
    raw = _yaml.safe_load(_example_path().read_text())
    raw["geometry"] = {
        "dimensionality": 1,
        "domain_bounds": {"x": ["0 m", "1 m"]},
        "boundary_conditions": [{"name": "left", "kind": "dirichlet"}],
    }
    from simworkbench.model_spec import from_dict as _from_dict
    spec1d = _from_dict(raw)
    exp = Experiment.from_model_spec(spec1d)
    with pytest.raises(ValueError, match="0D"):
        _mod.simulate(exp)

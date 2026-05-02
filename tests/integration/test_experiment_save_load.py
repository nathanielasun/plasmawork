"""Integration coverage for Phase 1A experiment save/load."""

from __future__ import annotations

from pathlib import Path

from simworkbench.experiment import Experiment
from simworkbench.model_spec import load_yaml
from simworkbench.serialization import load_experiment, save_experiment


def test_save_and_load_experiment_yaml(tmp_path):
    spec = load_yaml(
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )
    experiment = Experiment.from_model_spec(
        spec,
        run_config={"start_time": "0 s", "end_time": "25 ns", "seed": 7},
        backend_config={"name": "python_cpu"},
    )

    path = tmp_path / "experiment.yaml"
    save_experiment(experiment, path)
    loaded = load_experiment(path)

    assert loaded.name == "simple_rate_equations"
    assert loaded.model_spec.model.name == spec.model.name
    assert loaded.backend_config.name == "python_cpu"
    assert loaded.run_config.seed == 7
    assert {diagnostic.quantity for diagnostic in loaded.diagnostics} == {"A", "B"}

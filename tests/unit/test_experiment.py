"""Phase 1A — core Experiment model tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from simworkbench import BackendConfig, DiagnosticConfig, Experiment, RunConfig
from simworkbench.experiment import ExperimentError
from simworkbench.model_spec import load_yaml


def _example_spec():
    return load_yaml(
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )


def test_experiment_from_modelspec_defaults_diagnostics():
    spec = _example_spec()
    experiment = Experiment.from_model_spec(spec)
    assert experiment.name == "simple_rate_equations"
    assert experiment.backend_config.name == "python_cpu"
    assert {d.quantity for d in experiment.diagnostics} == {"A", "B"}


def test_run_config_requires_time_units():
    with pytest.raises(ExperimentError, match="run_config.start_time"):
        Experiment.from_dict(
            {
                "name": "bad_run",
                "model_spec": _example_spec(),
                "run_config": {"start_time": 0, "end_time": "1 s"},
            }
        )


def test_run_config_requires_end_after_start():
    with pytest.raises(ValueError, match="end_time"):
        RunConfig(start_time="1 s", end_time="0 s")


def test_backend_config_rejects_unknown_backend():
    with pytest.raises(ValueError, match="Unknown backend"):
        BackendConfig(name="made_up_backend")


def test_diagnostic_config_requires_positive_cadence():
    with pytest.raises(ValueError, match="cadence_steps"):
        DiagnosticConfig(name="bad", quantity="A", cadence_steps=0)


def test_experiment_rejects_unknown_diagnostic_quantity():
    with pytest.raises(ExperimentError, match="unknown quantity"):
        Experiment.from_dict(
            {
                "name": "bad_diag",
                "model_spec": _example_spec(),
                "diagnostics": [{"name": "ghost", "quantity": "Z"}],
            }
        )


def test_experiment_yaml_roundtrip(tmp_path):
    experiment = Experiment.from_model_spec(
        _example_spec(),
        run_config={"start_time": "0 s", "end_time": "10 ns", "seed": 123},
        metadata={"purpose": "unit test"},
    )
    out = tmp_path / "experiment.yaml"
    experiment.save_yaml(out)
    reloaded = Experiment.load_yaml(out)
    assert reloaded.name == experiment.name
    assert reloaded.run_config.seed == 123
    assert reloaded.run_config.end_time.magnitude == pytest.approx(10)
    assert str(reloaded.run_config.end_time.units) == "nanosecond"
    assert reloaded.model_spec.model.name == "simple_rate_equations"

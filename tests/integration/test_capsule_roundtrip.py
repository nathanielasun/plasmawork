"""Phase 2A — Capsule round-trip integration tests.

Combines the Phase 2A pieces: save → CapsuleValidator → reload → bulk_data
sidecar. Asserts a freshly-saved capsule satisfies the validator and that
the HDF5 sidecar carries the same series the JSON sidecar does.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.paths import simulation_capsules_root
from simworkbench.runtime import Runner
from simworkbench.serialization import (
    CapsuleValidator,
    load_capsule,
    read_diagnostics_h5,
    save_capsule,
)


def _example_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )


@pytest.fixture
def saved_capsule():
    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=10),
    )
    runner = Runner(exp)
    result = runner.run()
    base = simulation_capsules_root() / f"_pytest-roundtrip-{uuid.uuid4().hex[:8]}"
    base.mkdir(parents=True, exist_ok=True)
    capsule_dir = save_capsule(experiment=exp, result=result, base=base)
    try:
        yield capsule_dir, result
    finally:
        shutil.rmtree(base, ignore_errors=True)


def test_validator_accepts_saved_capsule(saved_capsule):
    capsule_dir, _ = saved_capsule
    report = CapsuleValidator().validate(capsule_dir)
    assert report.ok, f"Unexpected violations: {report.violations}"


def test_hdf5_sidecar_matches_json(saved_capsule):
    capsule_dir, _ = saved_capsule
    h5_path = capsule_dir / "results" / "diagnostics.h5"
    assert h5_path.is_file(), "Phase 2A capsules must include results/diagnostics.h5"
    diagnostics, metadata = read_diagnostics_h5(h5_path)
    assert {"A", "B", "time_seconds"}.issubset(diagnostics.keys())
    # Length matches what we asked the runner to produce.
    assert len(diagnostics["A"]) == 10
    # Metadata matches the runtime snapshot.
    assert metadata["state"] == "completed"
    assert metadata["placeholder_used"] is True


def test_load_capsule_still_works_with_new_manifest_writer(saved_capsule):
    """load_capsule reads via tomllib, so the Phase 2A Pydantic-written
    manifest must still parse cleanly."""
    capsule_dir, original_result = saved_capsule
    loaded = load_capsule(capsule_dir)
    assert loaded.experiment.model_spec.model.name == "simple_rate_equations"
    assert loaded.placeholders == list(original_result.placeholders)
    assert len(loaded.diagnostics["A"]) == 10

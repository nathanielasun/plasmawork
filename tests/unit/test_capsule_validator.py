"""Phase 2A — Capsule directory validator tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import load_yaml
from simworkbench.runtime import Runner
from simworkbench.serialization import save_capsule
from simworkbench.serialization.validator import CapsuleValidator


def _example_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "simple_rate_equations"
        / "model.yaml"
    )


@pytest.fixture
def saved_capsule():
    """A real saved capsule under simulation_capsules/, cleaned up after."""
    import shutil
    import uuid

    from simworkbench.paths import simulation_capsules_root

    spec = load_yaml(_example_path())
    exp = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(start_time="0 s", end_time="100 ns", max_steps=5),
    )
    runner = Runner(exp)
    result = runner.run()

    base = simulation_capsules_root() / f"_pytest-validator-{uuid.uuid4().hex[:8]}"
    base.mkdir(parents=True, exist_ok=True)
    capsule_dir = save_capsule(experiment=exp, result=result, base=base)
    try:
        yield capsule_dir
    finally:
        shutil.rmtree(base, ignore_errors=True)


def test_validator_passes_on_freshly_saved_capsule(saved_capsule):
    report = CapsuleValidator().validate(saved_capsule)
    assert report.ok, f"Unexpected violations: {report.violations}"
    assert report.manifest is not None
    assert report.manifest.runtime.placeholder_used is True


def test_validator_reports_missing_directory(tmp_path):
    target = tmp_path / "no-such-capsule.lxp"
    report = CapsuleValidator().validate(target)
    assert not report.ok
    codes = [v.code for v in report.errors]
    assert "missing_capsule_directory" in codes


def test_validator_reports_missing_required_files(saved_capsule):
    # Delete a required file.
    (saved_capsule / "manifest.toml").unlink()
    report = CapsuleValidator().validate(saved_capsule)
    assert not report.ok
    codes = [v.code for v in report.errors]
    assert "missing_required_file" in codes


def test_validator_reports_missing_required_subdir(saved_capsule):
    # Remove the model directory.
    import shutil

    shutil.rmtree(saved_capsule / "model")
    report = CapsuleValidator().validate(saved_capsule)
    assert not report.ok
    codes = [v.code for v in report.errors]
    assert "missing_required_subdir" in codes


def test_validator_warns_on_missing_recommended_subdir(saved_capsule):
    # The Phase 1 minimal capsule already creates recommended subdirs as
    # empty placeholders; remove one to provoke the warning.
    import shutil

    shutil.rmtree(saved_capsule / "paper_sources")
    report = CapsuleValidator().validate(saved_capsule)
    # Errors should still be empty.
    assert report.ok
    codes = [v.code for v in report.warnings]
    assert "missing_recommended_subdir" in codes


def test_validator_reports_unsupported_format_version(saved_capsule):
    # Edit the manifest in place.
    manifest_path = saved_capsule / "manifest.toml"
    text = manifest_path.read_text()
    manifest_path.write_text(text.replace('format_version = "0.1"', 'format_version = "99.0"'))
    report = CapsuleValidator().validate(saved_capsule)
    # Manifest fails to validate in load_manifest because of the
    # format_version check on the model side.
    assert not report.ok
    codes = [v.code for v in report.errors]
    assert "manifest_schema_invalid" in codes or "unsupported_format_version" in codes


def test_validator_reports_missing_referenced_model_spec(saved_capsule):
    (saved_capsule / "model" / "model_spec.yaml").unlink()
    report = CapsuleValidator().validate(saved_capsule)
    codes = [v.code for v in report.errors]
    # The MISSING_REQUIRED_FILE check fires (model/model_spec.yaml is required)
    # AND the manifest-pointer check fires.
    assert "missing_required_file" in codes


def test_validator_requires_diagnostics_h5(saved_capsule):
    """HDF5 is the canonical bulk-data format (ADR-0002 Accepted).
    Removing it must flip the validator to a hard failure.

    Regression for the post-Phase-2-close finding "validator accepts a
    capsule with no diagnostics.h5".
    """
    (saved_capsule / "results" / "diagnostics.h5").unlink()
    report = CapsuleValidator().validate(saved_capsule)
    assert not report.ok
    error_paths = [v.path for v in report.errors]
    assert "results/diagnostics.h5" in error_paths


def test_validator_requires_environment_yaml(saved_capsule):
    """provenance/environment.yaml is part of the Phase 2B triad.
    Removing it must flip the validator to a hard failure.

    Regression for the post-Phase-2-close finding "validator does not
    require provenance/environment.yaml".
    """
    (saved_capsule / "provenance" / "environment.yaml").unlink()
    report = CapsuleValidator().validate(saved_capsule)
    assert not report.ok
    error_paths = [v.path for v in report.errors]
    assert "provenance/environment.yaml" in error_paths


def test_validator_warns_on_missing_diagnostics_json_sidecar(saved_capsule):
    """JSON sidecar is only recommended (warning, not error)."""
    (saved_capsule / "results" / "diagnostics.json").unlink()
    report = CapsuleValidator().validate(saved_capsule)
    assert report.ok, f"Unexpected errors: {report.errors}"
    codes = [v.code for v in report.warnings]
    assert "missing_recommended_file" in codes

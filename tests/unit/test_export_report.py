"""Phase 2C — Report exporter tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from simworkbench.serialization.exporters.report import export_report
from simworkbench.serialization.manifest import (
    CapsuleSection,
    Manifest,
    ModelSection,
    RuntimeSection,
    write_manifest,
)


def _make_capsule(tmp_path: Path, *, placeholder_used: bool = False) -> Path:
    capsule = tmp_path / "tiny.lxp"
    (capsule / "model").mkdir(parents=True)
    (capsule / "configs").mkdir(parents=True)
    (capsule / "results").mkdir(parents=True)
    (capsule / "provenance").mkdir(parents=True)
    (capsule / "manifest.toml").touch()
    (capsule / "model" / "model_spec.yaml").write_text("model: {name: m, domain: laser_species}\n")
    (capsule / "configs" / "run_config.yaml").write_text("backend: python_cpu\n")
    (capsule / "results" / "diagnostics.json").write_text("{}\n")
    (capsule / "provenance" / "provenance.lock").write_text("\n")
    (capsule / "provenance" / "agent_trace.md").write_text("# trace\n")
    (capsule / "README.md").write_text("# tiny\n")

    manifest = Manifest(
        capsule=CapsuleSection(
            name="tiny",
            workbench_version="0.1.0",
            created_at="2026-05-02T00:00:00+00:00",
        ),
        model=ModelSection(name="m", domain="laser_species", schema_version="0.1"),
        runtime=RuntimeSection(
            backend="python_cpu",
            default_seed=0,
            final_state="completed",
            final_simulation_time_seconds=1.0e-7,
            elapsed_seconds=0.05,
            placeholder_used=placeholder_used,
            placeholders=["A_to_B"] if placeholder_used else [],
        ),
    )
    write_manifest(manifest, capsule / "manifest.toml")
    return capsule


def test_export_report_writes_markdown(tmp_path):
    capsule = _make_capsule(tmp_path)
    out = export_report(capsule, tmp_path / "target", require_workbench_target=False)
    assert out.is_file()
    text = out.read_text()
    assert "# Capsule report:" in text
    assert "Backend: `python_cpu`" in text
    assert "Validator status:" in text


def test_report_flags_exploratory_runs(tmp_path):
    capsule = _make_capsule(tmp_path, placeholder_used=True)
    out = export_report(capsule, tmp_path / "target", require_workbench_target=False)
    text = out.read_text()
    assert "Exploratory run notice" in text
    assert "A_to_B" in text


def test_report_omits_exploratory_for_validated_runs(tmp_path):
    capsule = _make_capsule(tmp_path, placeholder_used=False)
    out = export_report(capsule, tmp_path / "target", require_workbench_target=False)
    text = out.read_text()
    assert "Exploratory run notice" not in text


def test_export_report_refuses_outside_workbench(tmp_path):
    capsule = _make_capsule(tmp_path)
    with pytest.raises(PermissionError, match="outside workbench"):
        export_report(capsule, tmp_path / "external")

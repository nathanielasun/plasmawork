"""Phase 2C — Archive exporter tests."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest
from simworkbench.serialization.exporters.archive import export_archive


def _make_capsule(tmp_path: Path) -> Path:
    capsule = tmp_path / "demo.lxp"
    (capsule / "model").mkdir(parents=True)
    (capsule / "results").mkdir(parents=True)
    (capsule / "manifest.toml").write_text('[capsule]\nname = "demo"\n')
    (capsule / "model" / "model_spec.yaml").write_text("schema_version: '0.1'\n")
    (capsule / "results" / "diagnostics.json").write_text('{"ok": true}\n')
    return capsule


def test_export_archive_writes_zip(tmp_path):
    capsule = _make_capsule(tmp_path)
    out = export_archive(capsule, tmp_path / "target", require_workbench_target=False)
    assert out.suffix == ".zip"
    assert out.exists()
    with zipfile.ZipFile(out) as zf:
        names = set(zf.namelist())
    assert "demo.lxp/manifest.toml" in names
    assert "demo.lxp/model/model_spec.yaml" in names


def test_archive_uses_deflate_compression(tmp_path):
    capsule = _make_capsule(tmp_path)
    out = export_archive(capsule, tmp_path / "target", require_workbench_target=False)
    with zipfile.ZipFile(out) as zf:
        for info in zf.infolist():
            assert info.compress_type == zipfile.ZIP_DEFLATED


def test_export_archive_refuses_outside_workbench(tmp_path):
    capsule = _make_capsule(tmp_path)
    with pytest.raises(PermissionError, match="outside workbench"):
        export_archive(capsule, tmp_path / "external")


def test_export_archive_default_target_under_local_cache(tmp_path):
    """When no target is given, archive lands under local_cache/exports/."""
    # Create the capsule under simulation_capsules so the source itself is
    # workbench-local.
    from simworkbench.paths import local_cache_root, simulation_capsules_root

    capsule = simulation_capsules_root() / "_pytest-archive-default"
    capsule.mkdir(parents=True, exist_ok=True)
    try:
        (capsule / "manifest.toml").write_text('[capsule]\nname = "x"\n')
        archive = export_archive(capsule)
        assert archive.parent == local_cache_root() / "exports"
        assert archive.exists()
        archive.unlink()
        archive.parent.rmdir()
    finally:
        import shutil

        shutil.rmtree(capsule, ignore_errors=True)


def test_export_archive_missing_capsule_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Not a capsule directory"):
        export_archive(
            tmp_path / "no-such.lxp",
            tmp_path / "target",
            require_workbench_target=False,
        )

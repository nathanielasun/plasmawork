"""Phase 2C — Data exporter tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from simworkbench.serialization.exporters.data import export_data


def _make_capsule(tmp_path: Path) -> Path:
    capsule = tmp_path / "tiny.lxp"
    (capsule / "data").mkdir(parents=True)
    (capsule / "results").mkdir(parents=True)
    (capsule / "data" / "initial.h5").write_bytes(b"\x89HDF\r\n\x1a\n")
    (capsule / "results" / "diagnostics.json").write_text('{"ok": true}\n')
    return capsule


def test_export_data_copies_both_subdirs(tmp_path):
    capsule = _make_capsule(tmp_path)
    target = tmp_path / "target"
    out = export_data(capsule, target, require_workbench_target=False)
    paths = {p.name for p in out}
    assert paths == {"data", "results"}
    assert (target / "data" / "initial.h5").is_file()
    assert (target / "results" / "diagnostics.json").read_text() == '{"ok": true}\n'


def test_export_data_refuses_outside_workbench(tmp_path):
    capsule = _make_capsule(tmp_path)
    with pytest.raises(PermissionError, match="outside workbench"):
        export_data(capsule, tmp_path / "external")


def test_export_data_skips_missing_subdirs(tmp_path):
    capsule = tmp_path / "partial.lxp"
    (capsule / "data").mkdir(parents=True)
    (capsule / "data" / "only.h5").write_bytes(b"x")
    target = tmp_path / "target"
    out = export_data(capsule, target, require_workbench_target=False)
    assert {p.name for p in out} == {"data"}

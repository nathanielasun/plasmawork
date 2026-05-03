"""Phase 2C — Plot exporter tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from simworkbench.serialization.bulk_data import write_diagnostics_h5
from simworkbench.serialization.exporters.plots import export_plots


def _make_capsule_with_h5(tmp_path: Path) -> Path:
    capsule = tmp_path / "tiny.lxp"
    (capsule / "results").mkdir(parents=True)
    write_diagnostics_h5(
        {
            "time_seconds": [0.0, 0.1, 0.2, 0.3, 0.4],
            "A": [1.0, 0.9, 0.8, 0.7, 0.6],
            "B": [0.0, 0.1, 0.2, 0.3, 0.4],
        },
        capsule / "results" / "diagnostics.h5",
    )
    return capsule


def _make_capsule_with_json(tmp_path: Path) -> Path:
    capsule = tmp_path / "tiny.lxp"
    (capsule / "results").mkdir(parents=True)
    (capsule / "results" / "diagnostics.json").write_text(
        json.dumps(
            {
                "diagnostics": {
                    "time_seconds": [0.0, 0.1, 0.2],
                    "A": [1.0, 0.9, 0.8],
                }
            }
        )
    )
    return capsule


def test_export_plots_writes_png_and_svg_per_series(tmp_path):
    capsule = _make_capsule_with_h5(tmp_path)
    target = tmp_path / "target"
    out = export_plots(capsule, target, require_workbench_target=False)
    paths = {p.name for p in out}
    assert {"A.png", "A.svg", "B.png", "B.svg"} == paths
    for p in out:
        assert p.exists() and p.stat().st_size > 0


def test_export_plots_falls_back_to_json(tmp_path):
    capsule = _make_capsule_with_json(tmp_path)
    target = tmp_path / "target"
    out = export_plots(capsule, target, require_workbench_target=False)
    assert {p.name for p in out} == {"A.png", "A.svg"}


def test_export_plots_requires_diagnostics(tmp_path):
    capsule = tmp_path / "empty.lxp"
    (capsule / "results").mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="No results/diagnostics"):
        export_plots(capsule, tmp_path / "target", require_workbench_target=False)


def test_export_plots_refuses_outside_workbench(tmp_path):
    capsule = _make_capsule_with_h5(tmp_path)
    with pytest.raises(PermissionError, match="outside workbench"):
        export_plots(capsule, tmp_path / "external")

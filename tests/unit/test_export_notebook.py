"""Phase 2C — Notebook exporter tests."""

from __future__ import annotations

import json

import pytest
from simworkbench.serialization.exporters.notebook import export_notebook


def test_export_notebook_writes_valid_ipynb(tmp_path):
    capsule = tmp_path / "tiny.lxp"
    capsule.mkdir()
    target = tmp_path / "target"
    out = export_notebook(capsule, target, require_workbench_target=False)
    assert out.is_file()
    nb = json.loads(out.read_text())
    assert nb["nbformat"] == 4
    assert nb["nbformat_minor"] == 5
    assert "cells" in nb
    assert len(nb["cells"]) == 3
    assert nb["cells"][0]["cell_type"] == "markdown"
    assert nb["cells"][1]["cell_type"] == "code"


def test_notebook_metadata_carries_capsule_name(tmp_path):
    capsule = tmp_path / "demo.lxp"
    capsule.mkdir()
    out = export_notebook(capsule, tmp_path / "target", require_workbench_target=False)
    nb = json.loads(out.read_text())
    assert nb["metadata"]["simworkbench"]["capsule_name"] == "demo.lxp"


def test_notebook_loads_diagnostics_h5(tmp_path):
    capsule = tmp_path / "demo.lxp"
    capsule.mkdir()
    out = export_notebook(capsule, tmp_path / "target", require_workbench_target=False)
    nb = json.loads(out.read_text())
    code_lines = "".join(nb["cells"][1]["source"])
    assert "diagnostics.h5" in code_lines
    assert "h5py" in code_lines


def test_export_notebook_refuses_outside_workbench(tmp_path):
    capsule = tmp_path / "demo.lxp"
    capsule.mkdir()
    with pytest.raises(PermissionError, match="outside workbench"):
        export_notebook(capsule, tmp_path / "external")


def test_notebook_uses_relative_capsule_path(tmp_path):
    """Regression for the post-Phase-2-close finding "exported notebooks
    embed an absolute local capsule path".

    Notebooks must use a relative path (`Path('..') / 'results'`) so the
    export survives a rename or move. An absolute path would break
    portability — the entire reason the export exists.
    """
    capsule = tmp_path / "demo.lxp"
    capsule.mkdir()
    out = export_notebook(capsule, tmp_path / "target", require_workbench_target=False)
    nb = json.loads(out.read_text())
    code = "".join(nb["cells"][1]["source"])
    # Absolute path of the source must NOT appear verbatim — that is what
    # the bug looked like.
    assert str(capsule.resolve()) not in code, (
        "Notebook embeds an absolute path; exports must remain portable."
    )
    # And the notebook must use a relative reference.
    assert "Path('..')" in code or "../results" in code

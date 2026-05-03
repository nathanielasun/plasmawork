"""Phase 2C — Code exporter tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from simworkbench.serialization.exporters.code import CODE_SUBDIRS, export_code


def _make_capsule(tmp_path: Path) -> Path:
    capsule = tmp_path / "tiny.lxp"
    src = capsule / "src"
    (src / "generated").mkdir(parents=True)
    (src / "user_edits").mkdir(parents=True)
    (src / "kernels").mkdir(parents=True)
    (src / "generated" / "runner.py").write_text("# generated\n")
    (src / "user_edits" / "tweaks.py").write_text("# user\n")
    (src / "kernels" / "kernel.cpp").write_text("// stub\n")
    return capsule


def test_export_code_copies_three_subdirs(tmp_path):
    capsule = _make_capsule(tmp_path)
    target = tmp_path / "target"
    out = export_code(capsule, target, require_workbench_target=False)
    assert out == target / "src"
    for sub in CODE_SUBDIRS:
        assert (out / sub).is_dir()
    assert (out / "generated" / "runner.py").read_text() == "# generated\n"
    assert (out / "user_edits" / "tweaks.py").read_text() == "# user\n"
    assert (out / "kernels" / "kernel.cpp").read_text() == "// stub\n"


def test_export_code_refuses_outside_workbench(tmp_path):
    capsule = _make_capsule(tmp_path)
    target = tmp_path / "external"
    with pytest.raises(PermissionError, match="outside workbench"):
        export_code(capsule, target)


def test_export_code_skips_missing_subdir(tmp_path):
    capsule = tmp_path / "partial.lxp"
    src = capsule / "src" / "generated"
    src.mkdir(parents=True)
    (src / "x.py").write_text("# x\n")
    target = tmp_path / "target"
    out = export_code(capsule, target, require_workbench_target=False)
    assert (out / "generated" / "x.py").is_file()
    assert not (out / "user_edits").exists()
    assert not (out / "kernels").exists()


def test_export_code_does_not_modify_source_user_edits(tmp_path):
    """Carries `agent_error_patterns.md` "Overwriting <capsule>/src/user_edits/"
    forward into export — exporting must not modify the source's user_edits."""
    capsule = _make_capsule(tmp_path)
    user_file = capsule / "src" / "user_edits" / "tweaks.py"
    original = user_file.read_text()
    target = tmp_path / "target"
    export_code(capsule, target, require_workbench_target=False)
    assert user_file.read_text() == original


def test_export_code_no_src_dir_raises(tmp_path):
    target = tmp_path / "target"
    with pytest.raises(FileNotFoundError, match="no src/ directory"):
        export_code(tmp_path / "no-such-capsule.lxp", target, require_workbench_target=False)

"""Phase 1C — paths helper tests.

The paths module is the only sanctioned way for workbench code to choose where
to write artifacts. These tests assert the resolution order, the four allowed
roots, and the ``is_under_workbench`` guard the runtime relies on to refuse
escapes.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from simworkbench.paths import (
    is_under_workbench,
    local_cache_root,
    repo_root,
    simulation_capsules_root,
    temp_imports_root,
    temp_runs_root,
)


def test_repo_root_locates_workbench_root():
    root = repo_root()
    assert (root / "AGENTS.md").is_file()
    assert (root / "CLAUDE.md").is_file()
    assert (root / "README.md").is_file()


def test_repo_root_respects_env_override(tmp_path, monkeypatch):
    # Create a fake repo that has the marker files.
    (tmp_path / "AGENTS.md").write_text("stub")
    (tmp_path / "CLAUDE.md").write_text("stub")
    monkeypatch.setenv("SIMWORKBENCH_REPO_ROOT", str(tmp_path))

    # The lru_cache means we have to clear it for the override to take effect.
    repo_root.cache_clear()  # type: ignore[attr-defined]
    try:
        assert repo_root() == tmp_path
    finally:
        repo_root.cache_clear()  # type: ignore[attr-defined]


def test_four_allowed_roots_exist_after_first_access():
    for root_fn in (
        local_cache_root,
        temp_imports_root,
        temp_runs_root,
        simulation_capsules_root,
    ):
        path = root_fn()
        assert path.is_dir(), f"{root_fn.__name__}() did not create the directory"
        assert is_under_workbench(path)


def test_is_under_workbench_accepts_subpaths():
    sub = temp_runs_root() / "some-run-id" / "checkpoints" / "step_000001.pkl"
    # We don't have to create the file; the predicate operates on path strings.
    assert is_under_workbench(sub)


def test_is_under_workbench_accepts_samefile_case_aliases():
    root = temp_runs_root()
    parts = list(root.parts)
    for index, part in enumerate(parts):
        toggled = part.swapcase()
        if toggled == part:
            continue
        alias_parts = [*parts]
        alias_parts[index] = toggled
        alias = Path(*alias_parts)
        try:
            if alias.samefile(root):
                assert is_under_workbench(alias / "case-alias-run" / "artifact.json")
                return
        except OSError:
            continue
    pytest.skip("case-sensitive filesystem has no samefile case alias")


def test_is_under_workbench_rejects_tmp_and_home():
    assert not is_under_workbench("/tmp/elsewhere.txt")
    assert not is_under_workbench(Path(os.path.expanduser("~")) / "elsewhere.txt")

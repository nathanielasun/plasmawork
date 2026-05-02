"""Regression for `bugs_and_fixes/agent_error_patterns.md` "Writing program
artifacts outside the project directory".

The runtime must refuse to write a checkpoint outside the four allowed
workbench roots (``local_cache/``, ``temp_imports/``, ``temp_runs/``,
``simulation_capsules/``). These tests protect against any future change
that bypasses ``simworkbench.paths.is_under_workbench``.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from simworkbench.runtime.checkpoint import Checkpoint, write_checkpoint


def test_refuses_to_write_to_tmp(tmp_path):
    chk = Checkpoint(run_id="r", step=1, time_seconds=0.0, state={})
    with pytest.raises(PermissionError, match="outside workbench"):
        write_checkpoint(chk, base=Path("/tmp"))


def test_refuses_to_write_to_user_home():
    chk = Checkpoint(run_id="r", step=1, time_seconds=0.0, state={})
    home = Path(os.path.expanduser("~"))
    with pytest.raises(PermissionError, match="outside workbench"):
        write_checkpoint(chk, base=home / "elsewhere")


def test_refuses_to_write_to_arbitrary_tmp_path(tmp_path):
    chk = Checkpoint(run_id="r", step=1, time_seconds=0.0, state={})
    # tmp_path is pytest's per-test scratch directory — outside the workbench.
    with pytest.raises(PermissionError, match="outside workbench"):
        write_checkpoint(chk, base=tmp_path)


def test_default_base_resolves_under_temp_runs():
    """Sanity: with no base override, the file lands in temp_runs/<run>/checkpoints/."""
    chk = Checkpoint(run_id="regression-default-base", step=1, time_seconds=0.0, state={})
    path = write_checkpoint(chk)
    assert "temp_runs" in path.parts

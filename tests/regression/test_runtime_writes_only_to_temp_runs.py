"""Regression for `bugs_and_fixes/agent_error_patterns.md`:
- "Writing program artifacts outside the project directory"
- "Side-effecting before validating" (the refusal must precede ``mkdir``).

The runtime must refuse to write a checkpoint outside the four allowed
workbench roots (``local_cache/``, ``temp_imports/``, ``temp_runs/``,
``simulation_capsules/``) AND must not create the rejected directory on disk
as a side effect.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from simworkbench.runtime.checkpoint import Checkpoint, checkpoint_dir, write_checkpoint


def test_refuses_to_write_to_tmp():
    chk = Checkpoint(run_id="r", step=1, time_seconds=0.0, state={})
    target = Path("/tmp/should-not-be-created-by-checkpoint")
    with pytest.raises(PermissionError, match="outside workbench"):
        write_checkpoint(chk, base=target)
    # Side-effect-before-validate guard: the directory must NOT exist.
    assert not (target / "checkpoints").exists(), (
        "Refused checkpoint left a directory on disk — validator ran after "
        "mkdir; see agent_error_patterns.md 'Side-effecting before validating'."
    )


def test_refuses_to_write_to_user_home():
    chk = Checkpoint(run_id="r", step=1, time_seconds=0.0, state={})
    home = Path(os.path.expanduser("~"))
    target = home / "should-not-be-created-by-workbench-tests"
    with pytest.raises(PermissionError, match="outside workbench"):
        write_checkpoint(chk, base=target)
    assert not (target / "checkpoints").exists(), (
        "Refused checkpoint left a directory in the user's home — fix the "
        "validator order."
    )


def test_refuses_to_write_to_arbitrary_tmp_path(tmp_path):
    chk = Checkpoint(run_id="r", step=1, time_seconds=0.0, state={})
    # tmp_path is pytest's per-test scratch directory — outside the workbench.
    with pytest.raises(PermissionError, match="outside workbench"):
        write_checkpoint(chk, base=tmp_path)
    assert not (tmp_path / "checkpoints").exists()


def test_checkpoint_dir_refuses_outside_workbench_paths(tmp_path):
    """Direct call to ``checkpoint_dir`` (used by code that doesn't go through
    ``write_checkpoint``) must also refuse — the validator lives at the
    earliest possible point."""
    with pytest.raises(PermissionError, match="outside workbench"):
        checkpoint_dir("r", base=tmp_path / "elsewhere")
    assert not (tmp_path / "elsewhere" / "checkpoints").exists()


def test_default_base_resolves_under_temp_runs():
    """Sanity: with no base override, the file lands in temp_runs/<run>/checkpoints/."""
    chk = Checkpoint(run_id="regression-default-base", step=1, time_seconds=0.0, state={})
    path = write_checkpoint(chk)
    assert "temp_runs" in path.parts

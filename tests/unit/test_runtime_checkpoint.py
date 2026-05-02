"""Phase 1C — Checkpoint write/restore tests."""

from __future__ import annotations

import numpy as np
import pytest

from simworkbench.paths import temp_runs_root
from simworkbench.runtime.checkpoint import (
    Checkpoint,
    checkpoint_dir,
    latest_checkpoint,
    read_checkpoint,
    write_checkpoint,
)


def _sample_checkpoint(run_id: str, step: int) -> Checkpoint:
    return Checkpoint(
        run_id=run_id,
        step=step,
        time_seconds=float(step) * 0.01,
        state={"densities": np.arange(4, dtype=np.float64).tolist()},
        backend="python_cpu",
        metadata={"base_seed": 0},
    )


def test_write_creates_file_under_temp_runs(tmp_path, monkeypatch):
    chk = _sample_checkpoint("test-run-001", step=5)
    path = write_checkpoint(chk)
    assert path.exists()
    # Path is under temp_runs/<run_id>/checkpoints/
    assert temp_runs_root() in path.parents


def test_write_creates_json_sidecar():
    chk = _sample_checkpoint("test-run-002", step=7)
    path = write_checkpoint(chk)
    sidecar = path.with_suffix(".json")
    assert sidecar.exists()
    text = sidecar.read_text()
    assert "test-run-002" in text
    assert "python_cpu" in text


def test_read_roundtrip_preserves_fields():
    chk = _sample_checkpoint("test-run-003", step=12)
    path = write_checkpoint(chk)
    restored = read_checkpoint(path)
    assert restored.run_id == "test-run-003"
    assert restored.step == 12
    assert restored.time_seconds == pytest.approx(0.12)
    assert restored.backend == "python_cpu"
    assert restored.state == {"densities": [0.0, 1.0, 2.0, 3.0]}


def test_latest_checkpoint_returns_highest_step():
    run_id = "test-run-004"
    write_checkpoint(_sample_checkpoint(run_id, step=10))
    write_checkpoint(_sample_checkpoint(run_id, step=20))
    write_checkpoint(_sample_checkpoint(run_id, step=15))
    latest = latest_checkpoint(run_id)
    assert latest is not None
    assert "step_000020" in latest.name


def test_write_refuses_paths_outside_workbench(tmp_path):
    chk = _sample_checkpoint("test-run-005", step=1)
    # Pass an explicit base outside the workbench roots.
    with pytest.raises(PermissionError, match="outside workbench"):
        write_checkpoint(chk, base=tmp_path / "elsewhere")


def test_checkpoint_dir_is_inside_temp_runs():
    cdir = checkpoint_dir("test-run-006")
    assert temp_runs_root() in cdir.parents
    assert cdir.name == "checkpoints"

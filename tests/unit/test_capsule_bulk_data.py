"""Phase 2A — HDF5 bulk-data writer/reader tests."""

from __future__ import annotations

import numpy as np
import pytest
from simworkbench.serialization.bulk_data import (
    read_diagnostics_h5,
    write_diagnostics_h5,
)


def test_round_trip_preserves_arrays(tmp_path):
    diagnostics = {
        "time_seconds": [0.0, 0.1, 0.2, 0.3],
        "A": [1.0e18, 9.5e17, 9.0e17, 8.5e17],
        "B": [0.0, 5.0e16, 1.0e17, 1.5e17],
    }
    target = tmp_path / "diagnostics.h5"
    write_diagnostics_h5(diagnostics, target)
    assert target.exists()
    loaded, metadata = read_diagnostics_h5(target)
    assert set(loaded) == {"time_seconds", "A", "B"}
    np.testing.assert_array_equal(loaded["A"], np.asarray(diagnostics["A"]))
    np.testing.assert_array_equal(loaded["B"], np.asarray(diagnostics["B"]))
    assert metadata == {}


def test_round_trip_preserves_metadata(tmp_path):
    target = tmp_path / "diagnostics.h5"
    write_diagnostics_h5(
        {"x": [1.0, 2.0]},
        target,
        metadata={
            "run_id": "abc123",
            "state": "completed",
            "elapsed_seconds": 0.05,
            "placeholder_used": True,
        },
    )
    _, metadata = read_diagnostics_h5(target)
    assert metadata["run_id"] == "abc123"
    assert metadata["state"] == "completed"
    assert metadata["elapsed_seconds"] == pytest.approx(0.05)
    assert metadata["placeholder_used"] is True


def test_handles_numpy_arrays_directly(tmp_path):
    target = tmp_path / "diagnostics.h5"
    arr = np.linspace(0, 1, 100)
    write_diagnostics_h5({"linspace": arr}, target)
    loaded, _ = read_diagnostics_h5(target)
    np.testing.assert_array_equal(loaded["linspace"], arr)


def test_creates_parent_directories(tmp_path):
    nested = tmp_path / "a" / "b" / "c" / "diagnostics.h5"
    write_diagnostics_h5({"x": [0.0]}, nested)
    assert nested.exists()


def test_dataset_is_compressed(tmp_path):
    """Compression keeps capsule size sane for long time series."""
    import h5py

    target = tmp_path / "diagnostics.h5"
    write_diagnostics_h5({"x": list(range(10000))}, target)
    with h5py.File(target, "r") as fh:
        assert fh["x"].compression == "gzip"

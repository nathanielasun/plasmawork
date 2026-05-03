"""Phase 2A — HDF5 bulk-data writer/reader for capsule diagnostics.

Per ADR-0002 (Accepted): HDF5 is the primary bulk-data format for capsules
in Phase 2. Zarr is deferred to Phase 8 if HPC parallel-write parity becomes
the constraint. The wrapper here is the public API; ``h5py`` is the
implementation.

Phase 1's minimal capsule wrote diagnostics to a JSON sidecar; Phase 2 keeps
that sidecar (for tools that don't read HDF5) and adds an authoritative
``results/diagnostics.h5`` file with one dataset per diagnostic series.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import h5py
import numpy as np


def write_diagnostics_h5(
    diagnostics: dict[str, list[float] | np.ndarray],
    path: str | Path,
    *,
    metadata: dict[str, Any] | None = None,
) -> Path:
    """Write per-diagnostic time series to an HDF5 file.

    ``diagnostics`` maps a diagnostic name (e.g. ``"A"``, ``"B"``,
    ``"time_seconds"``) to its 1D numeric series. Each becomes a dataset at
    the file root. ``metadata`` is written as root-level attributes.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(target, "w") as fh:
        for name, series in diagnostics.items():
            arr = np.asarray(series, dtype=np.float64)
            fh.create_dataset(
                name,
                data=arr,
                # gzip-3 strikes a reasonable size/speed balance for short
                # time-series. Capsule sizes stay modest in Phase 2.
                compression="gzip",
                compression_opts=3,
            )
        if metadata:
            for k, v in metadata.items():
                # h5py accepts bytes/str/numeric scalars and arrays for attrs.
                fh.attrs[k] = _coerce_attr(v)
    return target


def read_diagnostics_h5(path: str | Path) -> tuple[dict[str, np.ndarray], dict[str, Any]]:
    """Read diagnostics + metadata from an HDF5 file.

    Returns ``(diagnostics_dict, metadata_dict)``. Datasets become numpy
    arrays; root attrs become metadata.
    """
    with h5py.File(Path(path), "r") as fh:
        diagnostics = {name: fh[name][...] for name in fh}
        metadata = {k: _from_attr(fh.attrs[k]) for k in fh.attrs}
    return diagnostics, metadata


def _coerce_attr(value: Any) -> Any:
    """Make a Python value HDF5-attribute-friendly. Leaves scalars and arrays
    alone; converts None to empty string and bools to numpy bool."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return np.bool_(value)
    return value


def _from_attr(value: Any) -> Any:
    """Reverse `_coerce_attr` for read-back: bytes -> str."""
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.ndarray) and value.dtype.kind in ("S", "O"):
        return [_from_attr(v) for v in value.tolist()]
    return value


__all__ = ["read_diagnostics_h5", "write_diagnostics_h5"]

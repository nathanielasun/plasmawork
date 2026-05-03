"""Phase 2C — Data exporter.

Copies the capsule's ``data/`` and ``results/`` subtrees to the target.
Includes the HDF5 sidecar from Phase 2A (``results/diagnostics.h5``).
"""

from __future__ import annotations

import shutil
from pathlib import Path

from simworkbench.paths import is_under_workbench

DATA_SUBDIRS = ("data", "results")


def export_data(
    capsule_dir: str | Path,
    target: str | Path,
    *,
    require_workbench_target: bool = True,
) -> tuple[Path, ...]:
    """Copy data + results subtrees. Returns the destination directories."""
    targets: list[Path] = []
    for sub in DATA_SUBDIRS:
        source = Path(capsule_dir) / sub
        if not source.is_dir():
            continue
        dest = Path(target) / sub
        if require_workbench_target and not is_under_workbench(dest):
            raise PermissionError(
                f"Refusing to export {sub} outside workbench-managed roots: {dest}"
            )
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(source, dest)
        targets.append(dest)
    return tuple(targets)


__all__ = ["DATA_SUBDIRS", "export_data"]

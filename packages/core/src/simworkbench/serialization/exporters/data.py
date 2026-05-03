"""Phase 2C — Data exporter.

Copies the capsule's ``data/`` and ``results/`` subtrees to the target.
Includes the HDF5 sidecar from Phase 2A (``results/diagnostics.h5``).
"""

from __future__ import annotations

import shutil
from pathlib import Path

from simworkbench.paths import is_under_workbench

DATA_SUBDIRS = ("data", "results")


def _refuse_overlap(source: Path, dest: Path) -> None:
    """Raise before any destructive op if dest is the source or its ancestor.

    Honors `agent_error_patterns.md` "Destructive-before-guard in exporters".
    """
    src = source.resolve()
    dst = dest.resolve()
    if src == dst:
        raise ValueError(
            f"Refusing to export onto the source itself: {src} == {dst}."
        )
    try:
        src.relative_to(dst)
    except ValueError:
        return
    raise ValueError(
        f"Refusing to export into a parent of the source: {dst} contains {src}."
    )


def export_data(
    capsule_dir: str | Path,
    target: str | Path,
    *,
    require_workbench_target: bool = True,
) -> tuple[Path, ...]:
    """Copy data + results subtrees. Returns the destination directories."""
    # Validate every overlap and workbench-target rule BEFORE any rmtree, so
    # self-export never deletes the source.
    plan: list[tuple[Path, Path]] = []
    for sub in DATA_SUBDIRS:
        source = Path(capsule_dir) / sub
        if not source.is_dir():
            continue
        dest = Path(target) / sub
        if require_workbench_target and not is_under_workbench(dest):
            raise PermissionError(
                f"Refusing to export {sub} outside workbench-managed roots: {dest}"
            )
        _refuse_overlap(source, dest)
        plan.append((source, dest))

    targets: list[Path] = []
    for source, dest in plan:
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(source, dest)
        targets.append(dest)
    return tuple(targets)


__all__ = ["DATA_SUBDIRS", "export_data"]

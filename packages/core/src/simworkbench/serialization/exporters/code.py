"""Phase 2C — Code exporter.

Copies a capsule's ``src/{generated,user_edits,kernels}/`` subtrees to the
target. Preserves directory layout. ``user_edits/`` is read from the
capsule and written to the target — the operation never modifies the
capsule's own ``user_edits/`` (carries ``agent_error_patterns.md`` "Over-
writing `<capsule>/src/user_edits/`" forward into export).
"""

from __future__ import annotations

import shutil
from pathlib import Path

from simworkbench.paths import is_under_workbench

CODE_SUBDIRS = ("generated", "user_edits", "kernels")


def export_code(
    capsule_dir: str | Path,
    target: str | Path,
    *,
    require_workbench_target: bool = True,
) -> Path:
    """Copy ``<capsule>/src/`` to ``<target>/src/``. Returns the target src dir.

    ``require_workbench_target=True`` (the default) refuses to write outside
    the four allowed workbench roots — set to False only when the user has
    explicitly chosen an external destination via the export menu (Phase 2C
    UI hook).
    """
    src_root = Path(capsule_dir) / "src"
    if not src_root.is_dir():
        raise FileNotFoundError(f"Capsule has no src/ directory: {src_root}")

    out_root = Path(target) / "src"
    if require_workbench_target and not is_under_workbench(out_root):
        raise PermissionError(
            f"Refusing to export code outside workbench-managed roots: {out_root}. "
            "Pass require_workbench_target=False if the user has explicitly "
            "chosen an external destination via the export menu."
        )
    out_root.mkdir(parents=True, exist_ok=True)

    for subdir in CODE_SUBDIRS:
        source = src_root / subdir
        if not source.is_dir():
            continue
        dest = out_root / subdir
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(source, dest)

    return out_root


__all__ = ["CODE_SUBDIRS", "export_code"]

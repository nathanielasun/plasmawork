"""Phase 2C — Archive exporter.

Compressed `.lxp.zip` of a capsule directory. The directory form is
canonical (per ADR-0002 §"Archive form"); this archive is a transport
format. Uses ``zipfile.ZIP_DEFLATED`` for portable compression.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

from simworkbench.paths import is_under_workbench, local_cache_root


def export_archive(
    capsule_dir: str | Path,
    target: str | Path | None = None,
    *,
    require_workbench_target: bool = True,
) -> Path:
    """Compress the capsule into a `.lxp.zip` archive. Returns the archive path.

    If ``target`` is None, the archive lands under
    ``<repo>/local_cache/exports/<name>.lxp.zip`` (the canonical workbench-
    managed location for export artifacts).
    """
    capsule_path = Path(capsule_dir)
    if not capsule_path.is_dir():
        raise FileNotFoundError(f"Not a capsule directory: {capsule_path}")

    if target is None:
        archive = local_cache_root() / "exports" / f"{capsule_path.name}.zip"
    else:
        archive = Path(target)
        # If the caller passed a directory (existing or implied — i.e. no
        # `.zip` suffix), treat it as a destination dir and append the
        # archive filename. The directory is created before opening the
        # archive so this works whether or not the path exists yet.
        if archive.suffix != ".zip":
            archive = archive / f"{capsule_path.name}.zip"

    if require_workbench_target and not is_under_workbench(archive):
        raise PermissionError(
            f"Refusing to write archive outside workbench-managed roots: {archive}. "
            "Pass require_workbench_target=False if the user explicitly chose "
            "an external destination via the export menu."
        )
    archive.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in capsule_path.rglob("*"):
            if path.is_file():
                zf.write(path, arcname=path.relative_to(capsule_path.parent))

    return archive


__all__ = ["export_archive"]

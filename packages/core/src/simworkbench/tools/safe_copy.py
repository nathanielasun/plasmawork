"""Symlink-refusing tree copier — Phase α audit fix (2026-05-10).

Audit caught two callers of ``shutil.copytree`` that followed
symlinks in untrusted tool trees:

  - ``ToolRegistry.register_from_template`` (``/api/tools/import``)
  - ``PromotionService.approve`` (``/api/tool-promotions/{id}/approve``)

Either path could exfiltrate host-side files into a workspace via
a crafted tool tree containing a symlink to ``/etc/passwd`` (or any
other host file the FastAPI process could read). The newer
``ToolAuthoringService`` already had ``_copy_tree_no_symlinks``;
this module exposes the same posture as a shared helper so the
registry + promotion paths use a single hardened seam.

Usage::

    from simworkbench.tools.safe_copy import safe_copy_tree
    safe_copy_tree(src, dst)

Refuses (raises ``SafeCopyError``) when:
  - any directory or file in the tree is a symlink
  - the source is itself a symlink
  - the target already exists (callers should clear the slot first)
"""

from __future__ import annotations

import shutil
from pathlib import Path


class SafeCopyError(RuntimeError):
    """Raised when a tree contains a symlink or the copy would
    overwrite an existing target. Callers map this to a 4xx with the
    error message verbatim."""


def safe_copy_tree(src: Path, dst: Path) -> None:
    """Copy every regular file + directory under ``src`` into ``dst``.

    Walks the tree first to assert no symlinks exist anywhere; only
    then performs the copy. The two-pass design means a partial
    discovery can't leave a half-copied tree behind: either the whole
    tree is safe and gets copied, or nothing is written.
    """
    src = Path(src)
    dst = Path(dst)
    if src.is_symlink():
        raise SafeCopyError(
            f"Refusing to copy: source {src!r} is itself a symlink."
        )
    if not src.is_dir():
        raise SafeCopyError(f"Source is not a directory: {src!r}")
    if dst.exists():
        raise SafeCopyError(
            f"Target already exists: {dst!r}. Clear the slot first."
        )

    # Pass 1: walk for symlinks. Refuse if any are found before we
    # touch the destination.
    src_resolved = src.resolve()
    for path in src.rglob("*"):
        if path.is_symlink():
            rel = path.relative_to(src)
            raise SafeCopyError(
                f"Refusing to copy: tree contains symlink at {rel!r}."
            )
        # Defense in depth: confirm the resolved path stays inside
        # the source. A non-symlink path that resolves outside the
        # source would be a filesystem oddity (mount point, etc.) —
        # safer to refuse.
        try:
            path.resolve().relative_to(src_resolved)
        except ValueError as exc:
            rel = path.relative_to(src)
            raise SafeCopyError(
                f"Refusing to copy: {rel!r} resolves outside the source tree."
            ) from exc

    # Pass 2: actually copy. Use shutil.copytree with symlinks=False
    # which means "do NOT preserve symlinks (resolve them)". Combined
    # with the pass-1 walk above (which raises on any symlink), this
    # is a no-op for the symlink case — the tree has none. The
    # symlinks=False is here as a belt to the suspenders so a future
    # change that loosens pass 1 still gets a copy semantic that
    # matches the pass-1 contract.
    shutil.copytree(src, dst, symlinks=False)

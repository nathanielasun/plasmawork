"""Phase 2A — Identity migration v0.1 → v0.1.

Exists so Phase 3+ schema bumps have a precedent: every migration takes a
capsule directory in place and returns the new format version.
"""

from __future__ import annotations

from pathlib import Path


def migrate_v0_1_to_v0_1(capsule_dir: Path) -> str:
    """No-op identity migration. Returns the unchanged target version.

    Phase 2 ships only this migration; future phases register real upgrades
    via ``register_migration("0.1", "0.2", fn)`` etc.
    """
    if not capsule_dir.is_dir():
        raise FileNotFoundError(f"Not a capsule directory: {capsule_dir}")
    return "0.1"


__all__ = ["migrate_v0_1_to_v0_1"]

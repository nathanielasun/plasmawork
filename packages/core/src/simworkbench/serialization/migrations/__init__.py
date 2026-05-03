"""Phase 2A — Capsule migrations.

Each capsule format version pair (e.g. ``0.1 → 0.2``) registers a callable
that mutates a capsule directory in place. Phase 2 ships only the v0.1
identity migration; Phase 3+ adds real upgrades.

Use::

    from simworkbench.serialization.migrations import migrate_capsule

    migrate_capsule(capsule_dir, target_version="0.1")
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

# Type for a migration: takes the capsule directory and returns the new
# format version after the migration runs.
Migration = Callable[[Path], str]

# Registered migrations keyed by ``(from_version, to_version)``.
_REGISTRY: dict[tuple[str, str], Migration] = {}


def register_migration(from_version: str, to_version: str, fn: Migration) -> None:
    """Register a migration callable under (from_version, to_version)."""
    key = (from_version, to_version)
    if key in _REGISTRY:
        raise ValueError(f"Migration {key} already registered.")
    _REGISTRY[key] = fn


def known_migrations() -> tuple[tuple[str, str], ...]:
    return tuple(sorted(_REGISTRY))


def migrate_capsule(capsule_dir: Path, *, target_version: str) -> str:
    """Walk registered migrations from the capsule's current version to
    ``target_version``. Returns the final version reached.

    Phase 2 supports only ``0.1 → 0.1`` (identity). Future phases extend.
    """
    from simworkbench.serialization.manifest import load_manifest, write_manifest

    manifest_path = capsule_dir / "manifest.toml"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"No manifest.toml under {capsule_dir}")
    manifest = load_manifest(manifest_path)
    current = manifest.capsule.format_version
    if current == target_version:
        return current

    # Find a chain of registered migrations from `current` to target_version.
    chain: list[tuple[str, str]] = []
    seen: set[str] = {current}
    while current != target_version:
        next_step = _find_next(current, target_version)
        if next_step is None:
            raise ValueError(
                f"No migration path from {current!r} to {target_version!r}. "
                f"Known migrations: {known_migrations()}"
            )
        if next_step[1] in seen:
            raise ValueError(
                f"Migration cycle detected at {next_step!r}; aborting."
            )
        chain.append(next_step)
        current = next_step[1]
        seen.add(current)

    for step in chain:
        new_version = _REGISTRY[step](capsule_dir)
        # Update the manifest's recorded version.
        manifest = load_manifest(manifest_path)
        manifest.capsule.format_version = new_version
        write_manifest(manifest, manifest_path)

    return current


def _find_next(current: str, target: str) -> tuple[str, str] | None:
    """Return a registered migration starting at ``current`` that progresses
    toward ``target``. Phase 2's registry is small enough to brute-force.

    Identity steps (``(v, v)``) are excluded when ``target`` differs from
    ``current`` — otherwise the search loops on the v0.1 identity migration
    when asked to reach a future version that has no registered path.
    """
    # Direct match first.
    direct = (current, target)
    if direct in _REGISTRY:
        return direct
    # Otherwise any forward step from `current` that actually advances.
    candidates = [k for k in _REGISTRY if k[0] == current and k[1] != current]
    return candidates[0] if candidates else None


# Auto-register the v0.1 → v0.1 identity migration on import.
from simworkbench.serialization.migrations.v0_1 import (  # noqa: E402
    migrate_v0_1_to_v0_1,
)

register_migration("0.1", "0.1", migrate_v0_1_to_v0_1)


__all__ = ["Migration", "known_migrations", "migrate_capsule", "register_migration"]

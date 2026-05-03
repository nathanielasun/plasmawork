"""Phase 2A — Capsule migration registry tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from simworkbench.serialization.manifest import (
    CapsuleSection,
    Manifest,
    ModelSection,
    RuntimeSection,
    write_manifest,
)
from simworkbench.serialization.migrations import (
    known_migrations,
    migrate_capsule,
    register_migration,
)


def _make_capsule_dir(tmp_path: Path, *, format_version: str) -> Path:
    """Build a minimal capsule directory with a manifest at ``format_version``."""
    capsule = tmp_path / "tiny.lxp"
    capsule.mkdir()
    manifest = Manifest(
        capsule=CapsuleSection(
            name="tiny",
            format_version=format_version,
            workbench_version="0.1.0",
            created_at="2026-05-02T00:00:00+00:00",
        ),
        model=ModelSection(name="m", domain="d", schema_version="0.1"),
        runtime=RuntimeSection(
            backend="python_cpu",
            default_seed=0,
            final_state="completed",
            final_simulation_time_seconds=0.0,
            elapsed_seconds=0.0,
        ),
    )
    write_manifest(manifest, capsule / "manifest.toml")
    return capsule


def test_v0_1_identity_is_registered():
    assert ("0.1", "0.1") in known_migrations()


def test_migrate_to_same_version_is_noop(tmp_path):
    capsule = _make_capsule_dir(tmp_path, format_version="0.1")
    final = migrate_capsule(capsule, target_version="0.1")
    assert final == "0.1"


def test_migrate_unknown_target_raises(tmp_path):
    capsule = _make_capsule_dir(tmp_path, format_version="0.1")
    with pytest.raises(ValueError, match="No migration path"):
        migrate_capsule(capsule, target_version="2.0")


def test_migrate_missing_manifest_raises(tmp_path):
    capsule = tmp_path / "no-manifest.lxp"
    capsule.mkdir()
    with pytest.raises(FileNotFoundError, match="No manifest.toml"):
        migrate_capsule(capsule, target_version="0.1")


def test_register_duplicate_migration_raises():
    """Registering the same (from, to) twice is a programmer error."""

    def _noop(_):
        return "0.1"

    with pytest.raises(ValueError, match="already registered"):
        register_migration("0.1", "0.1", _noop)


def test_chained_migration_updates_manifest_version(tmp_path):
    """Register a fake 0.1 → 0.2 step and confirm the manifest is rewritten."""
    capsule = _make_capsule_dir(tmp_path, format_version="0.1")

    def _to_v0_2(_capsule_dir: Path) -> str:
        return "0.2"

    # Register only for this test; clean up afterward via pytest's request
    # finalizer wouldn't reach our private registry, so we accept the
    # short-lived state here. The (0.1 → 0.2) key is unique.
    register_migration("0.1", "0.2", _to_v0_2)
    try:
        # Migrate to 0.2 — only the registered step (0.1 → 0.2) runs; the
        # manifest is rewritten to reflect the new version.
        final = migrate_capsule(capsule, target_version="0.2")
        assert final == "0.2"

        # Loading needs to bypass the format-version validator since this
        # build's CAPSULE_FORMAT_VERSION is 0.1; we read the raw TOML.
        import tomllib

        with (capsule / "manifest.toml").open("rb") as fh:
            data = tomllib.load(fh)
        assert data["capsule"]["format_version"] == "0.2"
    finally:
        # Best-effort cleanup of the test-only migration entry so we don't
        # leak state into later tests.
        from simworkbench.serialization.migrations import _REGISTRY

        _REGISTRY.pop(("0.1", "0.2"), None)

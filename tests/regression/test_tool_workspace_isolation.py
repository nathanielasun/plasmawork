"""Phase α (2026-05-10) — workspace-scoped tool registry isolation.

Pins three contracts the per-workspace registry refactor introduced:

  1. A tool imported into workspace A is INVISIBLE from workspace B.
  2. A tool in ``shared-internal-tools`` is visible from EVERY workspace
     (the cross-workspace shared bucket).
  3. The migration sweep's ``_pending_migration/`` quarantine is never
     surfaced by ToolRegistry — even when a tool.yaml is present.

The previous flat layout treated ``local_cache/imported_tools/`` as a
cross-tenant cache; a tool imported in any workspace was visible to
every user. The Phase α refactor scopes the cache by slug. These
tests close that visibility leak.
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
import yaml
from simworkbench.paths import imported_tools_root_for, local_cache_root
from simworkbench.tools.registry import ToolRegistry


def _make_tool_yaml(directory: Path, name: str) -> None:
    """Write a minimal-but-valid tool.yaml at ``directory/tool.yaml``."""
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "tool.yaml").write_text(
        yaml.safe_dump(
            {
                "name": name,
                "version": "0.1.0",
                "type": "diagnostic",
                "status": "candidate",
                "description": "Workspace isolation probe.",
                "entrypoint": "src/tool.py:Tool",
                "inputs": [],
                "outputs": [],
                "validation": {"tests": [], "reference_cases": []},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )


@pytest.fixture
def workspace_a_tool() -> tuple[str, Path]:
    """Plant a tool under workspace A's imported_tools root.

    Yields the tool name + its directory. Tears down on test exit.
    """
    name = f"_pytest_iso_a_{uuid.uuid4().hex[:8]}"
    target = imported_tools_root_for("workspace_a") / name
    _make_tool_yaml(target, name)
    try:
        yield name, target
    finally:
        shutil.rmtree(target, ignore_errors=True)


@pytest.fixture
def workspace_b_tool() -> tuple[str, Path]:
    """Plant a tool under workspace B's imported_tools root."""
    name = f"_pytest_iso_b_{uuid.uuid4().hex[:8]}"
    target = imported_tools_root_for("workspace_b") / name
    _make_tool_yaml(target, name)
    try:
        yield name, target
    finally:
        shutil.rmtree(target, ignore_errors=True)


@pytest.fixture
def shared_internal_tool() -> tuple[str, Path]:
    """Plant a tool in the shared-internal-tools bucket."""
    name = f"_pytest_iso_shared_{uuid.uuid4().hex[:8]}"
    target = imported_tools_root_for("shared-internal-tools") / name
    _make_tool_yaml(target, name)
    try:
        yield name, target
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_tool_in_workspace_a_invisible_from_workspace_b(
    workspace_a_tool: tuple[str, Path],
):
    name_a, _ = workspace_a_tool
    registry_b = ToolRegistry(workspace_slug="workspace_b")
    registry_b.refresh()
    assert name_a not in registry_b, (
        f"Workspace B sees workspace A's tool {name_a!r} — isolation leak."
    )


def test_tool_in_workspace_a_visible_from_workspace_a(
    workspace_a_tool: tuple[str, Path],
):
    name_a, _ = workspace_a_tool
    registry_a = ToolRegistry(workspace_slug="workspace_a")
    registry_a.refresh()
    assert name_a in registry_a


def test_shared_internal_tool_visible_from_every_workspace(
    shared_internal_tool: tuple[str, Path],
):
    name, _ = shared_internal_tool
    for slug in ("workspace_a", "workspace_b", "private_xyz_xyz_xyz"):
        registry = ToolRegistry(workspace_slug=slug)
        registry.refresh()
        assert name in registry, (
            f"shared-internal-tools tool {name!r} not visible from {slug}"
        )


def test_quarantine_dir_is_skipped():
    """ToolRegistry MUST NOT walk ``imported_tools/_pending_migration/``.

    Plant a tool.yaml under the quarantine path; assert it's not
    visible from any workspace including ``shared-internal-tools``.
    """
    quarantine_root = local_cache_root() / "imported_tools" / "_pending_migration"
    name = f"_pytest_iso_quarantined_{uuid.uuid4().hex[:8]}"
    target = quarantine_root / name
    _make_tool_yaml(target, name)
    try:
        for slug in ("workspace_a", "shared-internal-tools"):
            registry = ToolRegistry(workspace_slug=slug)
            registry.refresh()
            assert name not in registry, (
                f"Quarantined tool {name!r} visible from {slug} — "
                "ToolRegistry should skip _pending_migration/."
            )
        # Legacy back-compat callers (no slug) ALSO must not walk it.
        legacy = ToolRegistry()
        legacy.refresh()
        assert name not in legacy
    finally:
        shutil.rmtree(target, ignore_errors=True)
        # Best-effort cleanup of the quarantine dir if we created it.
        if quarantine_root.is_dir() and not any(quarantine_root.iterdir()):
            quarantine_root.rmdir()


def test_workspace_local_tool_shadows_shared_internal_tool():
    """When the same tool name exists in BOTH the active workspace AND
    shared-internal-tools, the workspace-local tool wins. This pins
    the Phase α "later wins" read order: workspace > shared > legacy
    > canonical."""
    name = f"_pytest_iso_shadow_{uuid.uuid4().hex[:8]}"
    shared_target = imported_tools_root_for("shared-internal-tools") / name
    local_target = imported_tools_root_for("workspace_a") / name
    _make_tool_yaml(shared_target, name)
    _make_tool_yaml(local_target, name)
    try:
        registry = ToolRegistry(workspace_slug="workspace_a")
        registry.refresh()
        assert name in registry
        # The workspace-local entry wins (its directory is under
        # workspace_a/, not shared-internal-tools/).
        entry = registry.get(name)
        assert "workspace_a" in str(entry.directory)
        assert "shared-internal-tools" not in str(entry.directory)
    finally:
        shutil.rmtree(shared_target, ignore_errors=True)
        shutil.rmtree(local_target, ignore_errors=True)

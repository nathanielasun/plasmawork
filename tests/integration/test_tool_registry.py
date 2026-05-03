"""Phase 3B — Tool registry integration tests.

Exercises the user-facing flow that the Phase 3 gate promises:

  - Discover the example tool from the on-disk registry.
  - Load its entrypoint class.
  - Execute it through the BaseTool surface.
  - Promote / deprecate it via the registry's lifecycle methods.
  - Register a fresh tool from a template directory.

These are the behavioral tests the gate's "create a custom diagnostic
tool, test it, document it, register it, use it in an experiment, and
export it" promise rides on.
"""

from __future__ import annotations

import shutil
import subprocess

import numpy as np
import pytest
from simworkbench.paths import repo_root
from simworkbench.tools import (
    LifecycleError,
    ToolRegistry,
    ToolStatus,
)
from simworkbench.units import Q

REGISTRY_ROOT = repo_root() / "packages" / "internal_tools" / "registry"
TEMPLATES_ROOT = repo_root() / "packages" / "internal_tools" / "templates"


def test_registry_discovers_absorption_spectrum_diagnostic():
    registry = ToolRegistry()
    registry.refresh()
    assert "absorption_spectrum_diagnostic" in registry
    entry = registry.get("absorption_spectrum_diagnostic")
    assert entry.metadata.type == "diagnostic"
    assert entry.status == ToolStatus.CANDIDATE


def test_registry_loads_class_and_executes():
    """The example tool runs end-to-end through the registry."""
    registry = ToolRegistry()
    registry.refresh()
    cls = registry.get("absorption_spectrum_diagnostic").load_class()
    tool = cls()

    freq = Q(np.linspace(1.0, 5.0, 5), "Hz")
    intensity = Q(np.array([0.0, 1.0, 0.2, 0.8, 0.0]), "dimensionless")
    out = tool.execute(frequency=freq, intensity=intensity)
    assert out["peak_count"] == 2


def test_registry_index_is_stable():
    registry = ToolRegistry()
    registry.refresh()
    index = registry.index()
    names = [row["name"] for row in index]
    assert "absorption_spectrum_diagnostic" in names


def test_registry_set_status_persists_to_disk(tmp_path):
    """Promote/demote rewrites tool.yaml. We work on a copy under tmp_path
    so we don't permanently flip the canonical example tool's status.
    """
    src = REGISTRY_ROOT / "absorption_spectrum_diagnostic"
    dst_root = tmp_path / "registry"
    dst_root.mkdir(parents=True)
    shutil.copytree(src, dst_root / "absorption_spectrum_diagnostic")

    # Build a registry rooted at the temp dir by loading via the metadata
    # path directly — we don't have an API to swap roots, so we lean on
    # the fact that a fresh ToolRegistry walks the canonical paths plus
    # the imported_tools cache. To exercise set_status without polluting
    # the canonical registry, we use the imported_tools cache.
    import simworkbench.paths as paths_mod
    from simworkbench.tools.registry import _imported_root  # noqa: PLC2701

    real_local_cache = paths_mod.local_cache_root()
    imported = _imported_root()
    imported.mkdir(parents=True, exist_ok=True)
    imported_tool = imported / "_pytest_absorption"
    if imported_tool.exists():
        shutil.rmtree(imported_tool)
    shutil.copytree(src, imported_tool)
    # Rename the tool inside the copy so it doesn't collide with the
    # canonical example.
    yaml_path = imported_tool / "tool.yaml"
    text = yaml_path.read_text()
    yaml_path.write_text(
        text.replace(
            "name: absorption_spectrum_diagnostic",
            "name: _pytest_absorption",
        )
    )
    try:
        registry = ToolRegistry()
        registry.refresh()
        assert "_pytest_absorption" in registry
        # candidate → validated requires a human; agent should be refused.
        with pytest.raises(LifecycleError, match="human approval"):
            registry.set_status(
                "_pytest_absorption", ToolStatus.VALIDATED, actor="agent"
            )
        # Human reviewer can promote.
        registry.set_status("_pytest_absorption", ToolStatus.VALIDATED, actor="human")
        # Re-load and confirm the status persisted.
        registry2 = ToolRegistry()
        registry2.refresh()
        assert registry2.get("_pytest_absorption").status == ToolStatus.VALIDATED
    finally:
        shutil.rmtree(imported_tool, ignore_errors=True)
        # Clean up the imported-tools dir if we created it empty.
        if imported.is_dir() and not any(imported.iterdir()):
            imported.rmdir()
        # Sanity: we didn't accidentally move local_cache_root.
        assert paths_mod.local_cache_root() == real_local_cache


def test_registry_register_from_template(tmp_path):
    """Copying a template into the registry produces a discoverable tool.

    We point ``target_root`` at tmp_path so we don't pollute the canonical
    registry; the same code path runs from the UI's "register" button.
    """
    template = TEMPLATES_ROOT / "diagnostic"
    if not template.is_dir():
        pytest.skip("diagnostic template not yet shipped")
    workbench_target = repo_root() / "local_cache" / "imported_tools"
    workbench_target.mkdir(parents=True, exist_ok=True)
    target_name = f"_pytest_register_{tmp_path.name}"
    registry = ToolRegistry()
    try:
        registry.refresh()
        entry = registry.register_from_template(
            template, target_name, target_root=workbench_target
        )
        assert entry.name == target_name
        assert entry.directory.is_dir()
        assert (entry.directory / "tool.yaml").is_file()
    finally:
        target_dir = workbench_target / target_name
        if target_dir.exists():
            shutil.rmtree(target_dir)


def test_refresh_registry_script_exits_zero():
    """The refresh script wraps `python -m simworkbench.tools.refresh_registry`
    and must exit 0 on a green registry. Regression for the post-Phase-2
    audit pattern "Documented path that does not exist as an executable
    on disk"."""
    proc = subprocess.run(
        [str(repo_root() / "scripts" / "dev" / "refresh_registry.sh")],
        cwd=str(repo_root()),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    assert "absorption_spectrum_diagnostic" in proc.stdout

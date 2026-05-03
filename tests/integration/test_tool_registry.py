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
    ToolRegistryError,
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


def test_register_from_template_refuses_path_traversal():
    """Regression for the post-Phase-3-close finding "register_from_template
    allows path traversal side effects before registry validation".

    A ``target_name`` like ``../../escape`` previously got past the
    ``is_under_workbench(root)`` check (which only validated the root,
    not the resolved target) and created a directory outside the registry
    before any name-shaped validation fired. The fix rejects path-escape
    names BEFORE any filesystem touch.
    """
    template = TEMPLATES_ROOT / "diagnostic"
    if not template.is_dir():
        pytest.skip("diagnostic template not yet shipped")
    target_root = repo_root() / "local_cache" / "imported_tools"
    target_root.mkdir(parents=True, exist_ok=True)

    registry = ToolRegistry()
    registry.refresh()

    bad_names = [
        "../../escape_probe",
        "../escape_probe",
        "/abs/escape_probe",
        "with/slash",
        "with\\backslash",
        "..",
        ".",
        " ",
    ]
    for bad in bad_names:
        with pytest.raises((ToolRegistryError, PermissionError, ValueError, OSError)):
            registry.register_from_template(template, bad, target_root=target_root)
    # And nothing leaked into parent directories.
    assert not (repo_root() / "_phase3_escape_probe").exists()
    assert not (repo_root().parent / "escape_probe").exists()


def test_set_status_validated_requires_declared_tests(tmp_path):
    """Regression for the post-Phase-3-close finding "lifecycle promotion
    to validated is not scientifically gated".

    Plan §9.5 says ``validated`` requires "Passes tests and benchmark
    cases". A candidate tool with ``validation.tests: []`` was previously
    accepted as validated; the registry now refuses with LifecycleError.
    """
    src = REGISTRY_ROOT / "absorption_spectrum_diagnostic"
    target_root = repo_root() / "local_cache" / "imported_tools"
    target_root.mkdir(parents=True, exist_ok=True)
    target_name = f"_pytest_no_tests_{tmp_path.name}"
    target = target_root / target_name
    shutil.copytree(src, target)
    # Strip validation.tests so the gate has nothing to run.
    yaml_path = target / "tool.yaml"
    text = yaml_path.read_text()
    text = text.replace(
        "name: absorption_spectrum_diagnostic", f"name: {target_name}"
    )
    text = text.replace(
        "  tests:\n    - tests/test_absorption_spectrum.py",
        "  tests: []",
    )
    yaml_path.write_text(text)
    registry = ToolRegistry()
    try:
        registry.refresh()
        with pytest.raises(LifecycleError, match="validation.tests is empty"):
            registry.set_status(target_name, ToolStatus.VALIDATED, actor="human")
    finally:
        if target.exists():
            shutil.rmtree(target)


def test_set_status_validated_runs_tests_and_refuses_failures(tmp_path):
    """The promotion gate must actually run the declared tests, not just
    check the list is non-empty. Sanity-check by pointing validation.tests
    at a deliberately-failing test."""
    src = REGISTRY_ROOT / "absorption_spectrum_diagnostic"
    target_root = repo_root() / "local_cache" / "imported_tools"
    target_root.mkdir(parents=True, exist_ok=True)
    target_name = f"_pytest_failing_{tmp_path.name}"
    target = target_root / target_name
    shutil.copytree(src, target)
    yaml_path = target / "tool.yaml"
    yaml_path.write_text(
        yaml_path.read_text().replace(
            "name: absorption_spectrum_diagnostic", f"name: {target_name}"
        )
    )
    # Drop a failing test in.
    failing_test = target / "tests" / "test_failing.py"
    failing_test.write_text(
        "def test_obviously_fails():\n    assert False, 'designed to fail'\n"
    )
    new_yaml = yaml_path.read_text().replace(
        "  tests:\n    - tests/test_absorption_spectrum.py",
        "  tests:\n    - tests/test_failing.py",
    )
    yaml_path.write_text(new_yaml)
    registry = ToolRegistry()
    try:
        registry.refresh()
        with pytest.raises(LifecycleError, match="validation tests failed"):
            registry.set_status(target_name, ToolStatus.VALIDATED, actor="human")
    finally:
        if target.exists():
            shutil.rmtree(target)


def test_registered_tool_execute_validates_declared_outputs(tmp_path):
    """Regression for the post-Phase-3-close finding "output contracts are
    declared but not enforced". A BaseTool subclass declaring output
    ``expected`` could return ``{"wrong": 1}`` and execute() accepted it.

    Fix: ``RegisteredTool.execute()`` validates the returned ToolOutput
    against ``tool.yaml.outputs``.
    """
    src = REGISTRY_ROOT / "absorption_spectrum_diagnostic"
    target_root = repo_root() / "local_cache" / "imported_tools"
    target_root.mkdir(parents=True, exist_ok=True)
    target_name = f"_pytest_outputs_{tmp_path.name}"
    target = target_root / target_name
    shutil.copytree(src, target)
    yaml_path = target / "tool.yaml"
    text = yaml_path.read_text()
    text = text.replace(
        "name: absorption_spectrum_diagnostic", f"name: {target_name}"
    )
    yaml_path.write_text(text)
    # Replace the run() implementation with one that returns the WRONG keys.
    src_path = target / "src" / "tool.py"
    src_path.write_text(
        "from simworkbench.tools import BaseTool, ToolInput, ToolOutput\n"
        "\n"
        "class AbsorptionSpectrumDiagnostic(BaseTool):\n"
        f'    name = "{target_name}"\n'
        '    version = "0.1.0"\n'
        "    def validate_inputs(self, inputs: ToolInput) -> None:\n"
        "        inputs.require_array('frequency', units='Hz')\n"
        "        inputs.require_array('intensity')\n"
        "    def run(self, inputs: ToolInput) -> ToolOutput:\n"
        "        # Tool.yaml declares peaks + peak_count; we deliberately\n"
        "        # return a single 'wrong' key to trip the output contract.\n"
        "        return ToolOutput({'wrong': 1})\n"
    )
    registry = ToolRegistry()
    try:
        registry.refresh()
        from simworkbench.tools import ToolRegistryError
        from simworkbench.units import Q

        entry = registry.get(target_name)
        with pytest.raises(ToolRegistryError, match="missing declared"):
            entry.execute(
                frequency=Q(np.array([1.0, 2.0, 3.0]), "Hz"),
                intensity=Q(np.array([0.0, 1.0, 0.0]), "dimensionless"),
            )
    finally:
        if target.exists():
            shutil.rmtree(target)


def test_register_from_template_yields_loadable_tool(tmp_path):
    """Regression: the post-Phase-3-close audit found that registering a
    template produced a non-loadable tool because the source class still
    had ``name = "TEMPLATE"`` while ``tool.yaml`` had been stamped with
    the real name; ``load_class`` then refused the mismatch.

    Fix: register_from_template rewrites both. The integration test
    verifies the registered tool actually instantiates.
    """
    template = TEMPLATES_ROOT / "diagnostic"
    if not template.is_dir():
        pytest.skip("diagnostic template not yet shipped")
    target_root = repo_root() / "local_cache" / "imported_tools"
    target_root.mkdir(parents=True, exist_ok=True)
    target_name = f"_pytest_loadable_{tmp_path.name}"
    registry = ToolRegistry()
    try:
        registry.refresh()
        registry.register_from_template(template, target_name, target_root=target_root)
        cls = registry.get(target_name).load_class()
        assert cls.name == target_name
    finally:
        target_dir = target_root / target_name
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

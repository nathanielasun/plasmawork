"""Regression tests for Phase 7 module-promotion robustness.

The Phase 7 close claimed module lifecycle promotion was gated by
single-use approval tokens and benchmark evidence. The first audit found
``ModuleRegistry.set_status(..., actor="human")`` could promote directly,
even with ``benchmarks: []``. These tests pin the library gate itself, not
just an API wrapper.
"""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest
import yaml
from simworkbench.modules import ModuleRegistry, ModuleRegistryError, ModuleStatus
from simworkbench.modules.approval import (
    grant_module_approval,
    module_approval_path,
)
from simworkbench.tools import ApprovalError


def test_set_status_exposes_no_approval_or_test_bypass_flags():
    """The registry mutator itself is the gate, so it cannot expose
    convenience flags that skip token consumption or declared-test runs.
    """
    signature = inspect.signature(ModuleRegistry.set_status)
    assert "consume_approval" not in signature.parameters
    assert "run_tests" not in signature.parameters


def test_refresh_refuses_invalid_module_metadata(tmp_path):
    module_dir = _write_module(
        tmp_path,
        "probe_invalid_refresh",
        benchmarks=[],
        tests={"unit": ["tests/test_pass.py"]},
    )
    metadata = yaml.safe_load((module_dir / "module.yaml").read_text())
    metadata["status"] = "validated"
    (module_dir / "module.yaml").write_text(
        yaml.safe_dump(metadata, sort_keys=False),
        encoding="utf-8",
    )

    with pytest.raises(ModuleRegistryError, match="Invalid module metadata"):
        ModuleRegistry(modules_root=tmp_path)


def _write_module(
    root: Path,
    name: str,
    *,
    benchmarks: list[dict] | None = None,
    tests: dict[str, list[str]] | None = None,
) -> Path:
    module_dir = root / "probe" / name
    module_dir.mkdir(parents=True)
    (module_dir / "module.yaml").write_text(
        yaml.safe_dump(
            {
                "name": name,
                "version": "0.1.0",
                "domain": "probe",
                "status": "candidate",
                "description": "promotion gate probe",
                "outputs": [{"name": "x", "units": "dimensionless"}],
                "dependencies": [],
                "benchmarks": benchmarks or [],
                "compatibility": {
                    "schema_version": "0.1",
                    "backends": ["python_cpu"],
                    "dimensionalities": [0],
                },
                "tests": tests or {},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return module_dir


def test_human_actor_without_token_is_not_enough(tmp_path):
    module_dir = _write_module(
        tmp_path,
        "probe_needs_token",
        benchmarks=[
            {
                "id": "analytic",
                "artifact": "benchmarks/analytic.py",
                "tolerance": "exact",
            }
        ],
        tests={"benchmark": ["tests/test_pass.py"]},
    )
    (module_dir / "benchmarks").mkdir()
    (module_dir / "benchmarks" / "analytic.py").write_text("# benchmark\n")
    (module_dir / "tests").mkdir()
    (module_dir / "tests" / "test_pass.py").write_text("def test_pass():\n    assert True\n")

    registry = ModuleRegistry(modules_root=tmp_path)
    with pytest.raises(ApprovalError):
        registry.set_status("probe_needs_token", ModuleStatus.VALIDATED, actor="human")


def test_validated_requires_benchmark_metadata_before_token(tmp_path):
    _write_module(
        tmp_path,
        "probe_no_benchmark",
        benchmarks=[],
        tests={"unit": ["tests/test_pass.py"]},
    )
    registry = ModuleRegistry(modules_root=tmp_path)
    with pytest.raises(ValueError, match="benchmarks"):
        registry.set_status("probe_no_benchmark", ModuleStatus.VALIDATED, actor="human")


def test_validated_requires_declared_tests_to_exist(tmp_path):
    module_dir = _write_module(
        tmp_path,
        "probe_missing_test",
        benchmarks=[
            {
                "id": "analytic",
                "artifact": "benchmarks/analytic.py",
                "tolerance": "exact",
            }
        ],
        tests={"benchmark": ["tests/test_missing.py"]},
    )
    (module_dir / "benchmarks").mkdir()
    (module_dir / "benchmarks" / "analytic.py").write_text("# benchmark\n")

    registry = ModuleRegistry(modules_root=tmp_path)
    with pytest.raises(ModuleRegistryError, match="does not exist"):
        registry.set_status("probe_missing_test", ModuleStatus.VALIDATED, actor="human")


def test_successful_promotion_consumes_token_and_survives_refresh(tmp_path):
    name = "probe_successful_promotion"
    module_dir = _write_module(
        tmp_path,
        name,
        benchmarks=[
            {
                "id": "analytic",
                "artifact": "benchmarks/analytic.py",
                "tolerance": "exact",
            }
        ],
        tests={"benchmark": ["tests/test_pass.py"]},
    )
    (module_dir / "benchmarks").mkdir()
    (module_dir / "benchmarks" / "analytic.py").write_text("# benchmark\n")
    (module_dir / "tests").mkdir()
    (module_dir / "tests" / "test_pass.py").write_text("def test_pass():\n    assert True\n")

    token = grant_module_approval(
        name,
        from_status="candidate",
        to_status="validated",
        reviewer="regression-test",
    )
    try:
        registry = ModuleRegistry(modules_root=tmp_path)
        promoted = registry.set_status(name, ModuleStatus.VALIDATED, actor="human")
        assert promoted.status is ModuleStatus.VALIDATED
        assert not token.exists(), "approval token must be single-use"

        refreshed = ModuleRegistry(modules_root=tmp_path)
        assert refreshed.get(name).status is ModuleStatus.VALIDATED
    finally:
        module_approval_path(
            name,
            from_status="candidate",
            to_status="validated",
        ).unlink(missing_ok=True)

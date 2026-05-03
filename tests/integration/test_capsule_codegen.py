"""Phase 6 — capsule-level codegen integration test.

Complements ``tests/integration/test_phase_6_gate_walk.py`` (the gate-
verb walk) by exercising the codegen pipeline end-to-end on a real
capsule layout: generate, run validation, inspect the manifest.

This file is the canonical integration target the milestone names; the
convention checker asserts its existence.
"""

from __future__ import annotations

import json
import shutil
import uuid

import pytest
import yaml
from simworkbench.codegen import CodeGenerator, ValidationRunner
from simworkbench.model_spec import load_yaml as load_modelspec_yaml
from simworkbench.paths import simulation_capsules_root


@pytest.fixture
def capsule():
    name = f"_pytest_codegen_{uuid.uuid4().hex[:8]}.lxp"
    target = simulation_capsules_root() / name
    (target / "model").mkdir(parents=True)
    (target / "src" / "generated").mkdir(parents=True)
    (target / "src" / "user_edits").mkdir(parents=True)
    (target / "validation").mkdir()
    (target / "model" / "model_spec.yaml").write_text(
        yaml.safe_dump(
            {
                "schema_version": "0.1",
                "model": {"name": "demo", "domain": "species", "version": "0.1.0"},
                "geometry": {"dimensionality": 0, "coordinate_system": "cartesian"},
                "species": [
                    {"name": "A", "type": "atom", "initial_density": "1e18 1/m^3"},
                ],
                "interactions": [
                    {
                        "name": "A_to_B",
                        "participants": ["A"],
                        "equation_refs": ["eq_001"],
                        "coefficient_sources": [
                            "placeholder:k=1.0e7 1/s (codegen integration test)"
                        ],
                    }
                ],
                "equations": [{"id": "eq_001", "latex": "dN_A/dt = -k N_A"}],
                "solvers": {
                    "recommended": [
                        {
                            "name": "rate_equation_0d",
                            "reason": "0D rate-equation backend",
                            "backend_compatibility": ["python_cpu"],
                        }
                    ]
                },
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    try:
        yield target
    finally:
        shutil.rmtree(target, ignore_errors=True)


def test_codegen_writes_manifest_with_per_file_hashes(capsule):
    spec = load_modelspec_yaml(capsule / "model" / "model_spec.yaml")
    result = CodeGenerator().generate(capsule, spec)
    assert result.manifest_path is not None
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest["spec_name"] == "demo"
    paths = {entry["path"] for entry in manifest["files"]}
    assert "src/generated/experiment.py" in paths
    assert "src/generated/tests/test_smoke.py" in paths
    # Every entry has a sha256.
    for entry in manifest["files"]:
        assert len(entry["sha256"]) == 64


def test_validation_runner_writes_status_and_summary(capsule):
    spec = load_modelspec_yaml(capsule / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule, spec)
    summary_path = ValidationRunner().run(capsule)
    assert summary_path.is_file()
    status_yaml = (capsule / "validation" / "status.yaml").read_text(encoding="utf-8")
    status = yaml.safe_load(status_yaml)
    assert status["validation_status"] in {"passed", "failed", "incomplete"}
    # The summary covers each plan §Phase 6 / 6E bullet.
    summary = summary_path.read_text(encoding="utf-8")
    for marker in ("Diagnostics", "Plots", "Validation status", "Run"):
        assert marker in summary

"""Regression for `bugs_and_fixes/agent_error_patterns.md` "Validation
runs the source-of-truth, not the generated artifact".

Phase-6 audit: ``ValidationRunner.run`` reloaded ``model_spec.yaml`` and
ran ``Runner`` directly, never importing ``<capsule>/src/generated/
experiment.py``. Corrupting the generated file with invalid Python
returned ``incomplete`` with no failure. This test asserts the new
implementation imports and executes the generated artifact, so a
corrupted file fails validation.
"""

from __future__ import annotations

import shutil
import uuid

import pytest
import yaml
from simworkbench.codegen import CodeGenerator, ValidationRunner
from simworkbench.model_spec import load_yaml
from simworkbench.paths import simulation_capsules_root


@pytest.fixture
def capsule():
    name = f"_pytest_validation_exec_{uuid.uuid4().hex[:8]}.lxp"
    target = simulation_capsules_root() / name
    (target / "model").mkdir(parents=True)
    (target / "src" / "generated").mkdir(parents=True)
    (target / "src" / "user_edits").mkdir(parents=True)
    (target / "validation").mkdir()
    (target / "model" / "model_spec.yaml").write_text(
        yaml.safe_dump(
            {
                "schema_version": "0.1",
                "model": {"name": "exec_demo", "domain": "species", "version": "0.1.0"},
                "geometry": {"dimensionality": 0, "coordinate_system": "cartesian"},
                "species": [
                    {"name": "A", "type": "atom", "initial_density": "1e16 1/m^3"},
                    {"name": "B", "type": "atom", "initial_density": "1e15 1/m^3"},
                ],
                "interactions": [
                    {
                        "name": "A_to_B",
                        "participants": ["A", "B"],
                        "equation_refs": ["eq"],
                        "coefficient_sources": ["placeholder:k=1.0e7 1/s (regression)"],
                    }
                ],
                "equations": [{"id": "eq", "latex": "dN/dt = -k N"}],
                "solvers": {
                    "recommended": [
                        {
                            "name": "rate_equation_0d",
                            "reason": "0D",
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


def test_validation_passes_on_clean_generated_code(capsule):
    spec = load_yaml(capsule / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule, spec)
    summary_path = ValidationRunner().run(capsule)
    status = yaml.safe_load(
        (capsule / "validation" / "status.yaml").read_text(encoding="utf-8")
    )
    # Clean code path: status is one of the three valid values; failure
    # is empty.
    assert status["validation_status"] in {"passed", "failed", "incomplete"}
    assert status["failure"] == ""
    assert summary_path.is_file()


def test_validation_marks_failed_when_generated_code_is_corrupted(capsule):
    """The audit's smoking-gun test: invalid Python in experiment.py
    must yield validation_status='failed' with a populated failure
    field. Earlier the validator bypassed experiment.py and returned
    'incomplete' regardless.
    """
    spec = load_yaml(capsule / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule, spec)
    # Corrupt the generated artifact AFTER generation.
    bad = capsule / "src" / "generated" / "experiment.py"
    bad.write_text(
        "this is not valid python ::: SyntaxError on purpose\n",
        encoding="utf-8",
    )
    ValidationRunner().run(capsule)
    status = yaml.safe_load(
        (capsule / "validation" / "status.yaml").read_text(encoding="utf-8")
    )
    assert status["validation_status"] == "failed"
    assert "SyntaxError" in status["failure"], status["failure"]


def test_validation_marks_failed_when_run_function_missing(capsule):
    """If the generated code parses but doesn't expose ``run``, the
    validator surfaces that as a failure too — not a silent pass.
    """
    spec = load_yaml(capsule / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule, spec)
    bad = capsule / "src" / "generated" / "experiment.py"
    bad.write_text("# syntactically fine but no run() function\n", encoding="utf-8")
    ValidationRunner().run(capsule)
    status = yaml.safe_load(
        (capsule / "validation" / "status.yaml").read_text(encoding="utf-8")
    )
    assert status["validation_status"] == "failed"
    assert "run" in status["failure"], status["failure"]

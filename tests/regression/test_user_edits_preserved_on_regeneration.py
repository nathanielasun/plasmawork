"""Phase 6 regression: regeneration must NEVER overwrite user_edits/.

Carries `bugs_and_fixes/agent_error_patterns.md` "Overwriting
<capsule>/src/user_edits/" — the always-named pattern. The 6B sandbox
guards each write at the producer side; this regression asserts the
guard from the consumer side as well (defense in depth).

The test plants a sentinel file under user_edits/ before AND after the
first generation, regenerates, and asserts both sentinels survive
byte-for-byte.
"""

from __future__ import annotations

import shutil
import uuid

import pytest
import yaml
from simworkbench.codegen import CodeGenerator, SandboxViolation, sandboxed_write
from simworkbench.model_spec import load_yaml
from simworkbench.paths import simulation_capsules_root


@pytest.fixture
def capsule():
    name = f"_pytest_user_edits_{uuid.uuid4().hex[:8]}.lxp"
    target = simulation_capsules_root() / name
    (target / "model").mkdir(parents=True)
    (target / "src" / "generated").mkdir(parents=True)
    (target / "src" / "user_edits").mkdir(parents=True)
    (target / "paper_sources").mkdir()
    (target / "provenance").mkdir()
    (target / "model" / "model_spec.yaml").write_text(
        yaml.safe_dump(
            {
                "schema_version": "0.1",
                "model": {
                    "name": "user_edits_demo",
                    "domain": "species",
                    "version": "0.1.0",
                },
                "geometry": {"dimensionality": 0, "coordinate_system": "cartesian"},
                "species": [
                    {"name": "A", "type": "atom", "initial_density": "1e16 1/m^3"},
                ],
                "interactions": [],
                "equations": [],
                "solvers": {
                    "recommended": [
                        {
                            "name": "rate_equation_0d",
                            "reason": "test",
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


def test_pre_generation_user_edit_survives(capsule):
    user_edit = capsule / "src" / "user_edits" / "before.py"
    user_edit.write_text("# planted before generate\n", encoding="utf-8")
    spec = load_yaml(capsule / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule, spec)
    assert user_edit.read_text(encoding="utf-8") == "# planted before generate\n"


def test_post_generation_user_edit_survives_regeneration(capsule):
    spec = load_yaml(capsule / "model" / "model_spec.yaml")
    CodeGenerator().generate(capsule, spec)
    user_edit = capsule / "src" / "user_edits" / "after.py"
    user_edit.write_text("# planted after first generate\n", encoding="utf-8")
    CodeGenerator().generate(capsule, spec)
    assert user_edit.read_text(encoding="utf-8") == "# planted after first generate\n"


def test_sandbox_refuses_explicit_write_under_user_edits(capsule):
    """Producer-side guard. The library's ``sandboxed_write`` refuses
    user_edits/ even when a caller explicitly asks for it. There is no
    ``allow_user_edits_overwrite=True`` opt-out."""
    with pytest.raises(SandboxViolation, match="user_edits"):
        sandboxed_write(capsule, "src/user_edits/sneaky.py", "# nope\n")


def test_sandbox_refuses_paper_sources_and_provenance(capsule):
    """Same producer-side guard for the other two off-limits subtrees."""
    with pytest.raises(SandboxViolation, match="paper_sources"):
        sandboxed_write(capsule, "paper_sources/sneaky.md", "# nope\n")
    with pytest.raises(SandboxViolation, match="provenance"):
        sandboxed_write(capsule, "provenance/sneaky.txt", "# nope\n")

"""Phase 5A — ModelSpec generation integration test (round-trip).

Generates a ModelSpec from a synthesized Phase-4 input, loads the
written YAML back, and asserts both spec versions agree on the
domain and the species count.
"""

from __future__ import annotations

import shutil
import uuid

import pytest
import yaml
from simworkbench.model_spec import load_yaml
from simworkbench.modeling import ModelSpecGenerator
from simworkbench.paths import simulation_capsules_root


@pytest.fixture
def reviewed_capsule():
    name = f"_pytest_5a_int_{uuid.uuid4().hex[:8]}.lxp"
    capsule = simulation_capsules_root() / name
    paper_sources = capsule / "paper_sources"
    paper_sources.mkdir(parents=True)
    (capsule / "model").mkdir()
    import json

    (paper_sources / "extracted_equations.json").write_text(
        json.dumps(
            [
                {
                    "id": "eq_001",
                    "text": "dx/dt = -k x",
                    "latex": "",
                    "source_line": 1,
                    "source_file": "p.md",
                    "confidence": 0.9,
                    "edited_by": "h",
                    "notes": "",
                }
            ]
        ),
        encoding="utf-8",
    )
    (paper_sources / "extracted_parameters.yaml").write_text(
        yaml.safe_dump(
            [
                {
                    "name": "k_decay",
                    "value": 1.0,
                    "unit": "1/s",
                    "missing_units": False,
                    "source_line": 1,
                    "source_file": "p.md",
                    "confidence": 0.9,
                    "edited_by": "h",
                    "notes": "",
                },
            ]
        ),
        encoding="utf-8",
    )
    for fname in (
        "paper_summary.md",
        "assumptions.md",
        "validity_domain.md",
        "implementation_plan.md",
    ):
        (paper_sources / fname).write_text(
            f"# {fname}\nspecies test.\n", encoding="utf-8"
        )
    yield capsule
    shutil.rmtree(capsule, ignore_errors=True)


def test_generated_modelspec_round_trips_through_load_yaml(reviewed_capsule):
    spec = ModelSpecGenerator().generate(reviewed_capsule)
    reloaded = load_yaml(reviewed_capsule / "model" / "model_spec.yaml")
    assert reloaded.model.domain == spec.model.domain
    assert len(reloaded.species) == len(spec.species)
    assert {ix.name for ix in reloaded.interactions} == {
        ix.name for ix in spec.interactions
    }

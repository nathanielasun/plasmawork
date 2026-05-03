"""Phase 5A — ModelSpecGenerator unit tests."""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

import pytest
import yaml
from simworkbench.modeling import ModelSpecGenerationError, ModelSpecGenerator
from simworkbench.paths import simulation_capsules_root


def _make_capsule(reviewed: bool) -> Path:
    name = f"_pytest_5a_{uuid.uuid4().hex[:8]}.lxp"
    capsule = simulation_capsules_root() / name
    paper_sources = capsule / "paper_sources"
    paper_sources.mkdir(parents=True)
    (capsule / "model").mkdir()
    edited_by = "human-reviewer" if reviewed else ""
    (paper_sources / "extracted_equations.json").write_text(
        json.dumps(
            [
                {
                    "id": "eq_001",
                    "text": "dN/dt = k N",
                    "latex": "dN/dt = k N",
                    "source_line": 5,
                    "source_file": "paper.md",
                    "confidence": 0.9,
                    "edited_by": edited_by,
                    "notes": "",
                },
            ]
        ),
        encoding="utf-8",
    )
    (paper_sources / "extracted_parameters.yaml").write_text(
        yaml.safe_dump(
            [
                {
                    "name": "k_pumping",
                    "value": 1.0,
                    "unit": "1/s",
                    "missing_units": False,
                    "source_line": 7,
                    "source_file": "paper.md",
                    "confidence": 0.9,
                    "edited_by": edited_by,
                    "notes": "",
                },
                {
                    "name": "N",
                    "value": 1.0e10,
                    "unit": "1/m^3",
                    "missing_units": False,
                    "source_line": 8,
                    "source_file": "paper.md",
                    "confidence": 0.9,
                    "edited_by": edited_by,
                    "notes": "",
                },
            ]
        ),
        encoding="utf-8",
    )
    (paper_sources / "paper_summary.md").write_text(
        "# Two-level laser_species kinetics\nReviewed.\n", encoding="utf-8"
    )
    (paper_sources / "assumptions.md").write_text("# Assumptions\n", encoding="utf-8")
    (paper_sources / "validity_domain.md").write_text("# Validity\n", encoding="utf-8")
    (paper_sources / "implementation_plan.md").write_text(
        "# Plan\n- domain: laser_species\n", encoding="utf-8"
    )
    return capsule


@pytest.fixture
def reviewed_capsule():
    capsule = _make_capsule(reviewed=True)
    yield capsule
    shutil.rmtree(capsule, ignore_errors=True)


@pytest.fixture
def unreviewed_capsule():
    capsule = _make_capsule(reviewed=False)
    yield capsule
    shutil.rmtree(capsule, ignore_errors=True)


def test_generate_writes_modelspec_yaml(reviewed_capsule):
    spec = ModelSpecGenerator().generate(reviewed_capsule)
    assert (reviewed_capsule / "model" / "model_spec.yaml").is_file()
    assert spec.model.domain == "laser_species"


def test_generate_resolves_species_and_interactions(reviewed_capsule):
    spec = ModelSpecGenerator().generate(reviewed_capsule)
    species_names = {s.name for s in spec.species}
    assert "N" in species_names
    interaction_names = {ix.name for ix in spec.interactions}
    assert any("k_pumping" in n for n in interaction_names)


def test_generate_refuses_unreviewed_when_required(unreviewed_capsule):
    with pytest.raises(ModelSpecGenerationError, match="reviewer|edited_by"):
        ModelSpecGenerator(require_reviewed=True).generate(unreviewed_capsule)


def test_generate_allows_unreviewed_when_flag_set(unreviewed_capsule):
    spec = ModelSpecGenerator(require_reviewed=False).generate(unreviewed_capsule)
    assert spec.model.domain in {"laser_species", "species"}


def test_generate_refuses_capsule_without_paper_sources(tmp_path):
    capsule = tmp_path / "no-paper.lxp"
    capsule.mkdir()
    with pytest.raises(ModelSpecGenerationError, match="paper_sources"):
        ModelSpecGenerator().generate(capsule)

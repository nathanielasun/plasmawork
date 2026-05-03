"""Phase 5 gate-walk integration test (written BEFORE implementation).

Plan §Phase 5 gate: "Phase 5 is complete when the system can transform
a reviewed paper interpretation into a validated ModelSpec and proposed
experiment plan."

Gate verbs:
  - transform — convert Phase-4 interpretation artifacts into a
                schema-valid ModelSpec.
  - map      — search the module registry, match domains/regimes/units,
               produce a module-match report.
  - analyze  — produce a gap report (missing modules, missing data,
               unsupported regimes, invalid solver, validation gaps).
  - propose  — produce experiment_proposal.md (minimal sim, fidelity
               extensions, cost estimate, validation path, backend rec).

This file is the canonical Phase 5 gate-walk and exists BEFORE any
implementation lands (per the new ninth Phase Gate Procedure check).
"""

from __future__ import annotations

import shutil
import uuid

import pytest
from fastapi.testclient import TestClient
from simworkbench.api import create_app
from simworkbench.paths import repo_root, simulation_capsules_root


@pytest.fixture
def reviewed_capsule():
    """A capsule whose paper_sources/ already holds Phase 4 interpretation
    artifacts (the input to Phase 5). We synthesize a minimal-but-valid
    set so the test doesn't depend on Phase-4 details beyond the file
    contracts.
    """
    name = f"_pytest_phase5_{uuid.uuid4().hex[:8]}.lxp"
    capsule_dir = simulation_capsules_root() / name
    paper_sources = capsule_dir / "paper_sources"
    paper_sources.mkdir(parents=True)
    (capsule_dir / "model").mkdir()
    (capsule_dir / "configs").mkdir()
    (capsule_dir / "results").mkdir()
    (capsule_dir / "provenance").mkdir()
    (capsule_dir / "manifest.toml").write_text(
        "[capsule]\n"
        f'name = "{name.removesuffix(".lxp")}"\n'
        'format_version = "0.1"\n'
        'workbench_version = "0.0.0"\n'
        'created_at = "2026-05-03T00:00:00.000000+00:00"\n\n'
        "[model]\n"
        'name = "_pytest"\n'
        'domain = "laser_species"\n'
        'schema_version = "0.1"\n'
        'model_spec_path = "model/model_spec.yaml"\n',
        encoding="utf-8",
    )
    # Synthesized Phase-4 outputs the Phase-5 generator consumes.
    import json

    import yaml

    (paper_sources / "extracted_equations.json").write_text(
        json.dumps(
            [
                {
                    "id": "eq_001",
                    "text": "dN_2/dt = k_p N_1 - gamma N_2",
                    "latex": "dN_2/dt = k_p N_1 - gamma N_2",
                    "source_line": 8,
                    "source_file": "paper_sources/sample.md",
                    "confidence": 0.9,
                    "edited_by": "human-reviewer",
                    "notes": "approved",
                },
            ],
            indent=2,
        ),
        encoding="utf-8",
    )
    (paper_sources / "extracted_parameters.yaml").write_text(
        yaml.safe_dump(
            [
                {
                    "name": "pumping_rate",
                    "value": 5.0e7,
                    "unit": "1/s",
                    "missing_units": False,
                    "source_line": 17,
                    "source_file": "paper_sources/sample.md",
                    "confidence": 0.9,
                    "edited_by": "human-reviewer",
                    "notes": "",
                },
                {
                    "name": "spontaneous_emission_rate",
                    "value": 4.0e8,
                    "unit": "1/s",
                    "missing_units": False,
                    "source_line": 18,
                    "source_file": "paper_sources/sample.md",
                    "confidence": 0.9,
                    "edited_by": "human-reviewer",
                    "notes": "",
                },
            ],
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (paper_sources / "paper_summary.md").write_text(
        "# Summary — laser_species two-level model\nReviewed by reviewer1.\n",
        encoding="utf-8",
    )
    (paper_sources / "assumptions.md").write_text(
        "# Assumptions\n- homogeneous medium\n- two-level approximation\n",
        encoding="utf-8",
    )
    (paper_sources / "validity_domain.md").write_text(
        "# Validity\nValid below 10 MW/cm^2.\n",
        encoding="utf-8",
    )
    (paper_sources / "implementation_plan.md").write_text(
        "# Implementation\n- domain: laser_species\n- backend: python_cpu\n",
        encoding="utf-8",
    )
    try:
        yield capsule_dir
    finally:
        shutil.rmtree(capsule_dir, ignore_errors=True)


def _client():
    return TestClient(create_app())


# ---------------------------------------------------------------------------
# Library-side gate verbs.
# ---------------------------------------------------------------------------


def test_phase_5_gate_walk_transform_to_modelspec(reviewed_capsule):
    """Verb: TRANSFORM — paper interpretation → schema-valid ModelSpec."""
    from simworkbench.modeling import ModelSpecGenerator

    spec = ModelSpecGenerator().generate(reviewed_capsule)
    # The generator wrote model/model_spec.yaml.
    spec_path = reviewed_capsule / "model" / "model_spec.yaml"
    assert spec_path.is_file()
    # And the result validates against the canonical ModelSpec schema.
    from simworkbench.model_spec import load_yaml

    loaded = load_yaml(spec_path)
    assert loaded.model.domain == "laser_species"
    # Species + interactions resolved.
    assert len(loaded.species) >= 1
    # Generator returned the same object it persisted.
    assert spec.model.domain == loaded.model.domain


def test_phase_5_gate_walk_map_modules(reviewed_capsule):
    """Verb: MAP — module registry searched + match report produced."""
    from simworkbench.modeling import ModelSpecGenerator, ModuleMatcher

    spec = ModelSpecGenerator().generate(reviewed_capsule)
    report = ModuleMatcher().match(spec)
    # The report is structured: every match carries a reason + score.
    assert hasattr(report, "matches")
    assert hasattr(report, "unmatched_requirements")


def test_phase_5_gate_walk_analyze_gaps(reviewed_capsule):
    """Verb: ANALYZE — gap report covers plan §10.4's five categories."""
    from simworkbench.modeling import (
        GapAnalyzer,
        ModelSpecGenerator,
        ModuleMatcher,
    )

    spec = ModelSpecGenerator().generate(reviewed_capsule)
    matches = ModuleMatcher().match(spec)
    gaps = GapAnalyzer().analyze(spec, matches)
    # Every category present (even if empty).
    for category in (
        "missing_modules",
        "missing_data",
        "unsupported_regimes",
        "invalid_solver_choices",
        "validation_gaps",
    ):
        assert category in gaps.to_dict(), f"Missing gap category: {category}"


def test_phase_5_gate_walk_propose_experiment(reviewed_capsule):
    """Verb: PROPOSE — experiment_proposal.md written; covers all five
    plan §Phase 5 / 5D bullets (minimal, extensions, cost, validation,
    backend).
    """
    from simworkbench.modeling import (
        ExperimentProposer,
        GapAnalyzer,
        ModelSpecGenerator,
        ModuleMatcher,
    )

    spec = ModelSpecGenerator().generate(reviewed_capsule)
    matches = ModuleMatcher().match(spec)
    gaps = GapAnalyzer().analyze(spec, matches)
    proposal_path = ExperimentProposer().propose(reviewed_capsule, spec, matches, gaps)
    assert proposal_path.is_file()
    body = proposal_path.read_text(encoding="utf-8")
    # The five §Phase 5 / 5D bullets each surface in the proposal.
    for marker in (
        "Minimal simulation",
        "fidelity",
        "Computational cost",
        "Validation path",
        "Backend",
    ):
        assert marker in body, f"Missing proposal section: {marker!r}"


# ---------------------------------------------------------------------------
# API-side gate verb.
# ---------------------------------------------------------------------------


def test_phase_5_gate_walk_api_propose(reviewed_capsule):
    """The full pipeline runs end-to-end through one API call:
    transform → map → analyze → propose."""
    r = _client().post(
        "/api/proposals",
        json={"capsule": reviewed_capsule.name},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "proposal_path" in body
    assert "matches" in body
    assert "gaps" in body
    proposal = (
        repo_root() / body["proposal_path"]
    ).read_text(encoding="utf-8")
    assert "Minimal simulation" in proposal


# ---------------------------------------------------------------------------
# Hard-rule guards.
# ---------------------------------------------------------------------------


def test_phase_5_gate_walk_refuses_unreviewed_interpretation(reviewed_capsule):
    """Plan §Phase 4 hard rule: agent-generated interpretation can't feed
    Phase 5 without a human reviewer's edit. We assert the generator
    refuses (or at minimum flags) interpretation files where no
    `edited_by` field is set.

    This carries the post-Phase-3 *Lifecycle promotion that checks the
    actor but not the artifact's scientific state* pattern: the Phase-5
    generator must check the artifact's review state, not just trust
    the file is on disk.
    """
    from simworkbench.modeling import ModelSpecGenerator

    # Strip the edited_by markers so the file looks unreviewed.
    eqs_path = reviewed_capsule / "paper_sources" / "extracted_equations.json"
    import json

    eqs = json.loads(eqs_path.read_text())
    for eq in eqs:
        eq["edited_by"] = ""
    eqs_path.write_text(json.dumps(eqs, indent=2), encoding="utf-8")

    with pytest.raises(Exception, match="reviewed|review|edited_by"):
        ModelSpecGenerator(require_reviewed=True).generate(reviewed_capsule)

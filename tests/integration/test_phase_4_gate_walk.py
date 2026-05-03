"""Phase 4 gate-walk integration test (written BEFORE implementation).

Plan §Phase 4 gate: "Phase 4 is complete when a paper can be **imported**
and **converted** into **human-reviewable scientific interpretation
artifacts**." (Plus the milestone's hard rule: every output requires
human review and edits are tracked in provenance.)

This test is the canonical gate-walk for Phase 4 — it exercises every
gate verb against a real on-disk capsule. The new ninth behavioral
check (added after the Phase 3 false close) requires the gate-walk file
to exist BEFORE the close commit.

Verbs covered:
  - import           — POST /api/papers/import (or PaperImporter)
  - extract equations — produces extracted_equations.json
  - extract parameters — produces extracted_parameters.yaml + flags missing units
  - generate interpretation artifacts — paper_summary.md, assumptions.md,
                       validity_domain.md, implementation_plan.md
  - review (read-only) — GET /api/papers/{capsule}/extracted
  - edit (with provenance) — POST /api/papers/{capsule}/edit
  - end-to-end orchestration — PaperImporter().ingest(...) produces all
                       deliverables in one call
"""

from __future__ import annotations

import json
import shutil
import uuid

import pytest
import yaml
from fastapi.testclient import TestClient
from simworkbench.api import create_app
from simworkbench.paths import repo_root, simulation_capsules_root

FIXTURE_PAPER = repo_root() / "tests" / "fixtures" / "phase_4_paper" / "sample.md"


@pytest.fixture
def empty_capsule():
    """A bare .lxp/ directory under simulation_capsules_root() to ingest into."""
    name = f"_pytest_phase4_{uuid.uuid4().hex[:8]}.lxp"
    capsule_dir = simulation_capsules_root() / name
    (capsule_dir / "paper_sources").mkdir(parents=True, exist_ok=True)
    (capsule_dir / "model").mkdir(parents=True, exist_ok=True)
    (capsule_dir / "configs").mkdir(parents=True, exist_ok=True)
    (capsule_dir / "results").mkdir(parents=True, exist_ok=True)
    (capsule_dir / "provenance").mkdir(parents=True, exist_ok=True)
    # Minimal manifest so the capsule is at least loadable.
    (capsule_dir / "manifest.toml").write_text(
        "[capsule]\n"
        f'name = "{name.removesuffix(".lxp")}"\n'
        'format_version = "0.1"\n'
        'workbench_version = "0.0.0"\n'
        'created_at = "2026-05-02T00:00:00.000000+00:00"\n\n'
        "[model]\n"
        'name = "_pytest"\n'
        'domain = "test"\n'
        'schema_version = "0.1"\n'
        'model_spec_path = "model/model_spec.yaml"\n',
        encoding="utf-8",
    )
    try:
        yield capsule_dir
    finally:
        shutil.rmtree(capsule_dir, ignore_errors=True)


def _client():
    return TestClient(create_app())


# ---------------------------------------------------------------------------
# Library-side gate verbs (PaperImporter — the engine the API wraps).
# ---------------------------------------------------------------------------


def test_phase_4_gate_walk_end_to_end_library(empty_capsule):
    """Library-side gate walk: PaperImporter.ingest() produces every
    deliverable plan §Phase 4 names.

    Plan §Phase 4 / 4A enumerates SIX task bullets:
      1. Import PDFs.       2. Store papers locally.
      3. Extract text.      4. Extract tables.
      5. Extract figures.   6. Preserve source files.
    Each task bullet must produce a separately-testable artifact.
    """

    from simworkbench.ingestion import PaperImporter

    importer = PaperImporter()
    artifacts = importer.ingest(FIXTURE_PAPER, empty_capsule)

    # 4A.2 + 4A.6 — paper imported under paper_sources/ verbatim.
    assert (empty_capsule / "paper_sources" / "sample.md").is_file()
    assert artifacts.paper_path == empty_capsule / "paper_sources" / "sample.md"

    # 4A.3 — extracted_text.md present and non-empty.
    extracted_text_path = empty_capsule / "paper_sources" / "extracted_text.md"
    assert extracted_text_path.is_file()
    assert extracted_text_path.read_text(encoding="utf-8").strip() != ""
    assert artifacts.extracted_text_path == extracted_text_path

    # 4A.4 — extracted_tables.json captures the cross-section table.
    tables_path = empty_capsule / "paper_sources" / "extracted_tables.json"
    assert tables_path.is_file()
    tables = json.loads(tables_path.read_text(encoding="utf-8"))
    assert len(tables) >= 1, tables
    first = tables[0]
    assert "Wavelength" in first["headers"]
    assert first["n_rows"] >= 2

    # 4A.5 — extracted_figures.json captures the figure metadata.
    figures_path = empty_capsule / "paper_sources" / "extracted_figures.json"
    assert figures_path.is_file()
    figures = json.loads(figures_path.read_text(encoding="utf-8"))
    assert len(figures) >= 1
    fig = figures[0]
    assert fig["alt"] == "KrF kinetics schematic"
    assert fig["path"].endswith("kinetics.png")
    # The "Figure 1: ..." caption beneath the image got attached.
    assert "Two-level" in fig["caption"]

    # 4B — extracted_equations.json present, has at least one equation,
    # each carries `confidence` + `source_line` fields.
    eqs_path = empty_capsule / "paper_sources" / "extracted_equations.json"
    assert eqs_path.is_file()
    equations = json.loads(eqs_path.read_text())
    assert len(equations) >= 1
    first = equations[0]
    assert "confidence" in first
    assert "source_line" in first
    assert "latex" in first or "text" in first

    # 4C — extracted_parameters.yaml present, flags missing_units rows.
    params_path = empty_capsule / "paper_sources" / "extracted_parameters.yaml"
    assert params_path.is_file()
    params = yaml.safe_load(params_path.read_text())
    assert isinstance(params, list) and len(params) >= 3
    # The fixture paper has at least one named-unit parameter and at least
    # one (placeholder_efficiency = 0.85) without units.
    has_named_unit = any(p.get("unit") for p in params)
    has_missing_unit = any(p.get("missing_units") is True for p in params)
    assert has_named_unit, params
    assert has_missing_unit, params

    # 4D — interpretation artifacts under paper_sources/.
    for filename in (
        "paper_summary.md",
        "assumptions.md",
        "validity_domain.md",
        "implementation_plan.md",
    ):
        path = empty_capsule / "paper_sources" / filename
        assert path.is_file(), f"Missing interpretation artifact: {filename}"
        text = path.read_text(encoding="utf-8")
        # Plan §Phase 4 hard rule: every interpretation output is human-
        # review-required. The default agent must mark sections clearly.
        assert "human review" in text.lower(), (
            f"{filename} must mark sections as needing human review "
            "(plan §Phase 4 hard rule)."
        )


# ---------------------------------------------------------------------------
# API-side gate verbs.
# ---------------------------------------------------------------------------


def test_phase_4_gate_walk_api_import(empty_capsule):
    client = _client()
    r = client.post(
        "/api/papers/import",
        json={
            "capsule": empty_capsule.name,
            "source_path": str(FIXTURE_PAPER),
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["paper_imported"].endswith("sample.md")
    assert (empty_capsule / "paper_sources" / "sample.md").is_file()


def test_phase_4_gate_walk_api_get_extracted(empty_capsule):
    """Review verb: GET /api/papers/{capsule}/extracted returns the
    structured extraction so the UI can render it.
    """
    from simworkbench.ingestion import PaperImporter

    PaperImporter().ingest(FIXTURE_PAPER, empty_capsule)
    r = _client().get(f"/api/papers/{empty_capsule.name}/extracted")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "equations" in body
    assert "parameters" in body
    assert "interpretation" in body
    assert isinstance(body["equations"], list)
    assert isinstance(body["parameters"], list)
    assert "paper_summary" in body["interpretation"]
    assert "assumptions" in body["interpretation"]
    assert "validity_domain" in body["interpretation"]
    assert "implementation_plan" in body["interpretation"]


def test_phase_4_gate_walk_api_edit_records_provenance(empty_capsule):
    """Edit verb: POST /api/papers/{capsule}/edit with a human correction
    must persist the change AND append an entry to agent_trace.md
    (carries the milestone's "Track edits in provenance" rule).
    """
    from simworkbench.ingestion import PaperImporter

    PaperImporter().ingest(FIXTURE_PAPER, empty_capsule)
    # Append-only agent_trace.md is created by the importer (Phase 2B
    # writers are wired through, NOT hand-rolled).
    trace_path = empty_capsule / "provenance" / "agent_trace.md"
    assert trace_path.is_file()
    before = trace_path.read_text(encoding="utf-8")

    r = _client().post(
        f"/api/papers/{empty_capsule.name}/edit",
        json={
            "artifact": "parameters",
            "index": 0,
            "field": "unit",
            "value": "1/s",
            "reviewer": "pytest-human",
        },
    )
    assert r.status_code == 200, r.text

    # The change persisted to disk.
    params = yaml.safe_load(
        (empty_capsule / "paper_sources" / "extracted_parameters.yaml").read_text()
    )
    assert params[0]["unit"] == "1/s"

    # And agent_trace.md grew by exactly one row that names the edit.
    after = trace_path.read_text(encoding="utf-8")
    assert len(after) > len(before)
    new_lines = after[len(before) :]
    assert "pytest-human" in new_lines
    assert "parameters[0].unit" in new_lines or "unit" in new_lines


def test_phase_4_gate_walk_api_edit_refuses_unknown_artifact(empty_capsule):
    """Negative case: a bogus artifact name is refused with 400 (not 500)."""
    from simworkbench.ingestion import PaperImporter

    PaperImporter().ingest(FIXTURE_PAPER, empty_capsule)
    r = _client().post(
        f"/api/papers/{empty_capsule.name}/edit",
        json={
            "artifact": "no-such-artifact",
            "index": 0,
            "field": "unit",
            "value": "1/s",
            "reviewer": "pytest-human",
        },
    )
    assert r.status_code == 400


def test_phase_4_gate_walk_api_edit_refuses_empty_reviewer(empty_capsule):
    """Regression for the post-Phase-4-close finding "edit API accepts an
    empty reviewer and records agent=reviewer: in provenance".

    The API boundary must reject empty / whitespace-only reviewers; the
    UI's required-field validation is necessary but not sufficient (other
    clients — curl, scripts, agents — bypass the UI entirely).
    """
    from simworkbench.ingestion import PaperImporter

    PaperImporter().ingest(FIXTURE_PAPER, empty_capsule)
    trace_path = empty_capsule / "provenance" / "agent_trace.md"
    before = trace_path.read_text(encoding="utf-8") if trace_path.is_file() else ""
    for bad_reviewer in ("", " ", "\t"):
        r = _client().post(
            f"/api/papers/{empty_capsule.name}/edit",
            json={
                "artifact": "parameters",
                "index": 0,
                "field": "unit",
                "value": "1/s",
                "reviewer": bad_reviewer,
            },
        )
        assert r.status_code == 400, (
            f"Empty reviewer {bad_reviewer!r} was accepted; provenance "
            "entries with no reviewer name corrupt the audit trail."
        )
    # Nothing leaked into provenance during the rejected attempts.
    after = trace_path.read_text(encoding="utf-8") if trace_path.is_file() else ""
    assert after == before, "Rejected edits must not append to agent_trace.md."


def test_phase_4_gate_walk_pdf_import_success_path(empty_capsule):
    """Plan §Phase 4 / 4A task bullet 1: 'Import PDFs.' Regression for
    the post-Phase-4 audit finding "extract_text() supports .pdf only if
    pypdf is installed, but pypdf is not in pyproject.toml ... a direct
    /api/papers/import PDF probe returned HTTP 500".

    The earlier fix added the structured ``TextExtractionError`` but
    didn't install pypdf and didn't catch the error at the API. This
    test asserts the SUCCESS path: PDF imports end-to-end via the API
    AND `extracted_text.md` contains the PDF's text. Carries
    `agent_error_patterns.md` "Shipping the structured error without
    shipping the success path".
    """
    fixture = (
        repo_root() / "tests" / "fixtures" / "phase_4_paper" / "sample.pdf"
    )
    assert fixture.is_file(), "PDF fixture missing"
    r = _client().post(
        "/api/papers/import",
        json={
            "capsule": empty_capsule.name,
            "source_path": str(fixture),
        },
    )
    assert r.status_code == 200, r.text
    extracted_text = (
        empty_capsule / "paper_sources" / "extracted_text.md"
    ).read_text(encoding="utf-8")
    assert "Phase 4 PDF fixture" in extracted_text


def test_phase_4_gate_walk_api_edit_interpretation_artifact(empty_capsule):
    """Edit verb covers EVERY editable artifact, including interpretation
    Markdown bodies. Regression for the post-Phase-4-close finding
    "InterpretationView is read-only and has no UI path to edit
    paper_summary, assumptions, validity_domain, or implementation_plan".

    This test exercises the API path that the UI now wires up.
    """
    from simworkbench.ingestion import PaperImporter

    PaperImporter().ingest(FIXTURE_PAPER, empty_capsule)
    new_body = "# Edited assumptions\nReviewed 2026-05-03.\n"
    r = _client().post(
        f"/api/papers/{empty_capsule.name}/edit",
        json={
            "artifact": "interpretation",
            "index": 1,  # 0=summary, 1=assumptions, 2=validity, 3=plan
            "field": "body",
            "value": new_body,
            "reviewer": "pytest-human",
        },
    )
    assert r.status_code == 200, r.text
    assumptions = (
        empty_capsule / "paper_sources" / "assumptions.md"
    ).read_text(encoding="utf-8")
    assert assumptions == new_body
    # And the trace recorded the edit.
    trace = (empty_capsule / "provenance" / "agent_trace.md").read_text(
        encoding="utf-8"
    )
    assert "interpretation[1].body" in trace
    assert "pytest-human" in trace


# ---------------------------------------------------------------------------
# Hard-rule guards from the milestone.
# ---------------------------------------------------------------------------


def test_phase_4_no_trusted_simulation_artifacts_produced(empty_capsule):
    """Plan §Phase 4 hard rule: 'Agents do not produce trusted simulations
    in this phase. Only interpretation artifacts.' The ingestion pipeline
    must NOT write to model/model_spec.yaml or trigger a runtime — the
    artifacts it produces are interpretation-only and explicitly marked
    for human review.
    """
    from simworkbench.ingestion import PaperImporter

    spec_path = empty_capsule / "model" / "model_spec.yaml"
    assert not spec_path.exists()
    PaperImporter().ingest(FIXTURE_PAPER, empty_capsule)
    # Still no model spec — that's Phase 5's job.
    assert not spec_path.exists()
    # And no diagnostics or results landed.
    assert not (empty_capsule / "results" / "diagnostics.h5").exists()
    assert not (empty_capsule / "results" / "diagnostics.json").exists()

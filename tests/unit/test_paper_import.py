"""Phase 4A — PaperImporter pipeline tests."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest
from simworkbench.ingestion import PaperImporter, PaperIngestionError
from simworkbench.paths import simulation_capsules_root

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "phase_4_paper"
    / "sample.md"
)


@pytest.fixture
def capsule(tmp_path):
    name = f"_pytest_import_{uuid.uuid4().hex[:8]}.lxp"
    capsule_dir = simulation_capsules_root() / name
    (capsule_dir / "paper_sources").mkdir(parents=True)
    (capsule_dir / "provenance").mkdir(parents=True)
    try:
        yield capsule_dir
    finally:
        shutil.rmtree(capsule_dir, ignore_errors=True)


def test_ingest_copies_paper_verbatim(capsule):
    artifacts = PaperImporter().ingest(FIXTURE, capsule)
    assert artifacts.paper_path.read_bytes() == FIXTURE.read_bytes()


def test_ingest_writes_all_four_interpretation_artifacts(capsule):
    PaperImporter().ingest(FIXTURE, capsule)
    for filename in (
        "paper_summary.md",
        "assumptions.md",
        "validity_domain.md",
        "implementation_plan.md",
    ):
        assert (capsule / "paper_sources" / filename).is_file()


def test_ingest_appends_provenance_via_writer(capsule):
    """Producer must invoke AgentTraceWriter (not hand-roll)."""
    PaperImporter().ingest(FIXTURE, capsule)
    trace_path = capsule / "provenance" / "agent_trace.md"
    assert trace_path.is_file()
    text = trace_path.read_text(encoding="utf-8")
    assert "PaperImporter" in text
    assert "ingested paper" in text


def test_ingest_refuses_missing_paper(capsule):
    with pytest.raises(PaperIngestionError, match="not found"):
        PaperImporter().ingest(FIXTURE.parent / "no_such.md", capsule)


def test_ingest_refuses_missing_capsule(tmp_path):
    with pytest.raises(PaperIngestionError, match="Capsule directory not found"):
        PaperImporter().ingest(FIXTURE, tmp_path / "no_such.lxp")


def test_ingest_does_not_touch_model_or_results(capsule):
    """Plan §Phase 4 hard rule: no trusted simulation outputs."""
    PaperImporter().ingest(FIXTURE, capsule)
    assert not (capsule / "model" / "model_spec.yaml").exists()
    assert not (capsule / "results" / "diagnostics.h5").exists()

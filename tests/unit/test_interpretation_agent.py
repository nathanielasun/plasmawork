"""Phase 4D — InterpretationAgent tests."""

from __future__ import annotations

from simworkbench.ingestion import (
    ExtractedEquation,
    ExtractedParameter,
    TemplateInterpretationAgent,
)


def test_emits_four_artifacts():
    agent = TemplateInterpretationAgent()
    out = agent.interpret(
        paper_text="# Title\n\nbody",
        equations=[],
        parameters=[],
        paper_filename="paper.md",
    )
    files = out.filenames()
    assert set(files) == {
        "paper_summary.md",
        "assumptions.md",
        "validity_domain.md",
        "implementation_plan.md",
    }


def test_every_artifact_marks_human_review_required():
    """Plan §Phase 4 hard rule: every output requires human review."""
    out = TemplateInterpretationAgent().interpret(
        paper_text="# Test\n",
        equations=[],
        parameters=[],
    )
    for body in out.filenames().values():
        assert "human review" in body.lower()


def test_assumptions_lists_parameters_with_unit_flag():
    params = [
        ExtractedParameter(
            name="kp", value=1.0, unit="1/s", source_line=1, source_file="paper.md"
        ),
        ExtractedParameter(
            name="x",
            value=0.5,
            unit="",
            missing_units=True,
            source_line=2,
            source_file="paper.md",
        ),
    ]
    out = TemplateInterpretationAgent().interpret(
        paper_text="# Test\n", equations=[], parameters=params
    )
    assert "kp" in out.assumptions
    assert "1/s" in out.assumptions
    # The missing-units row must be visibly flagged in the markdown.
    assert "MISSING" in out.assumptions
    assert "x" in out.assumptions


def test_implementation_plan_lists_equations():
    eqs = [
        ExtractedEquation(
            id="eq_001",
            text="dN/dt = -k N",
            source_line=5,
            source_file="paper.md",
            confidence=0.9,
        ),
    ]
    out = TemplateInterpretationAgent().interpret(
        paper_text="# Test\n", equations=eqs, parameters=[]
    )
    assert "eq_001" in out.implementation_plan
    assert "dN/dt = -k N" in out.implementation_plan


def test_validity_domain_extracts_section_when_present():
    text = (
        "# Title\n\n## Validity domain\n\n"
        "Valid below 10 MW/cm^2.\n\n## Other\nbody\n"
    )
    out = TemplateInterpretationAgent().interpret(
        paper_text=text, equations=[], parameters=[]
    )
    assert "Valid below 10 MW/cm^2." in out.validity_domain


def test_validity_domain_falls_back_when_section_absent():
    out = TemplateInterpretationAgent().interpret(
        paper_text="# Title\nNo validity heading here.\n",
        equations=[],
        parameters=[],
    )
    assert "did not find a 'Validity'" in out.validity_domain

"""Phase 4B — EquationExtractor tests."""

from __future__ import annotations

from simworkbench.ingestion import RegexEquationExtractor


def test_finds_display_equation():
    text = "intro\n\n$$E = mc^2$$\n\nend\n"
    eqs = RegexEquationExtractor().extract(text, source_file="paper.md")
    assert len(eqs) == 1
    assert eqs[0].text == "E = mc^2"
    assert eqs[0].source_line == 3
    assert eqs[0].confidence > 0.5


def test_finds_inline_equation():
    text = "We use $x = 1 + 2$ here.\n"
    eqs = RegexEquationExtractor().extract(text, source_file="paper.md")
    assert len(eqs) == 1
    assert eqs[0].text == "x = 1 + 2"


def test_finds_equation_environment():
    text = "\\begin{equation}\nF = ma\n\\end{equation}\n"
    eqs = RegexEquationExtractor().extract(text, source_file="paper.md")
    assert len(eqs) == 1
    assert "F = ma" in eqs[0].text
    assert eqs[0].notes == "detected via env pattern"


def test_extracts_from_fixture_paper():
    """The Phase 4 fixture has at least one display equation."""
    from pathlib import Path

    fixture = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "phase_4_paper"
        / "sample.md"
    )
    text = fixture.read_text()
    eqs = RegexEquationExtractor().extract(text, source_file=fixture.name)
    assert len(eqs) >= 1
    # Every extracted equation carries confidence + source_line.
    for eq in eqs:
        assert 0.0 <= eq.confidence <= 1.0
        assert eq.source_line >= 1


def test_ids_are_stable_and_ordered_by_source_line():
    text = "$$a$$\n\n$$bbb$$\n"
    eqs = RegexEquationExtractor().extract(text)
    assert eqs[0].id == "eq_001"
    assert eqs[1].id == "eq_002"
    assert eqs[0].source_line < eqs[1].source_line


def test_short_inline_gets_low_confidence():
    """`$x$` alone is too thin to be useful; haircut its confidence."""
    text = "see $x$ above.\n"
    eqs = RegexEquationExtractor().extract(text)
    assert eqs[0].confidence < 0.5

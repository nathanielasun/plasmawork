"""Phase 4A — text / table / figure extraction tests.

These cover the four task bullets of Workstream 4A that go beyond
"copy the source": extract text, extract tables, extract figures, and
the PDF entry point's structured "needs pypdf" error.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from simworkbench.ingestion import (
    TextExtractionError,
    extract_figures,
    extract_tables,
    extract_text,
)

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "phase_4_paper"
    / "sample.md"
)


# ---------------------------------------------------------------------------
# Text extraction.
# ---------------------------------------------------------------------------


def test_extract_text_from_markdown_returns_utf8_body():
    extracted = extract_text(FIXTURE)
    assert "KrF excimer" in extracted.text
    assert extracted.source_file == "sample.md"
    assert extracted.pages == 0


def test_extract_text_from_pdf_raises_when_pypdf_missing(tmp_path, monkeypatch):
    """If pypdf isn't installed, the extractor refuses with a clear error.
    We never silently return a stub for an unsupported binary format."""
    pdf = tmp_path / "fake.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")  # not a valid PDF, but the suffix is enough.
    # Hide pypdf if it happens to be installed.
    monkeypatch.setitem(sys.modules, "pypdf", None)
    with pytest.raises(TextExtractionError, match="pypdf"):
        extract_text(pdf)


# ---------------------------------------------------------------------------
# Table extraction.
# ---------------------------------------------------------------------------


def test_extract_tables_finds_pipe_table():
    text = (
        "intro\n\n"
        "| H1 | H2 |\n"
        "|----|----|\n"
        "| a  | b  |\n"
        "| c  | d  |\n"
        "\n"
        "outro\n"
    )
    tables = extract_tables(text, source_file="x.md")
    assert len(tables) == 1
    t = tables[0]
    assert t.headers == ["H1", "H2"]
    assert t.rows == [["a", "b"], ["c", "d"]]
    assert t.source_line == 3


def test_extract_tables_skips_non_table_pipe_lines():
    """Pipe characters in prose mustn't be misread as a table."""
    text = "prose with | pipe | char\nmore prose\n"
    tables = extract_tables(text)
    assert tables == []


def test_extract_tables_from_fixture():
    text = FIXTURE.read_text()
    tables = extract_tables(text, source_file="sample.md")
    assert len(tables) >= 1
    headers = tables[0].headers
    assert "Wavelength" in headers
    assert "Cross-section" in headers


# ---------------------------------------------------------------------------
# Figure extraction.
# ---------------------------------------------------------------------------


def test_extract_figures_captures_alt_path_and_caption():
    text = (
        "intro\n"
        "![my fig](figures/x.png)\n"
        "Figure 1: a useful caption\n"
        "outro\n"
    )
    figs = extract_figures(text, source_file="x.md")
    assert len(figs) == 1
    f = figs[0]
    assert f.alt == "my fig"
    assert f.path == "figures/x.png"
    assert f.caption == "a useful caption"
    assert f.source_line == 2


def test_extract_figures_uses_image_title_when_no_caption():
    text = '![alt](path "title here")\n\nNot a figure caption.\n'
    figs = extract_figures(text)
    assert figs[0].caption == "title here"


def test_extract_figures_from_fixture_paper():
    text = FIXTURE.read_text()
    figs = extract_figures(text, source_file="sample.md")
    assert len(figs) >= 1
    assert figs[0].alt == "KrF kinetics schematic"

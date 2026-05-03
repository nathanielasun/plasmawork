"""Phase 4C — ParameterExtractor tests."""

from __future__ import annotations

from pathlib import Path

from simworkbench.ingestion import RegexParameterExtractor

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "phase_4_paper"
    / "sample.md"
)


def test_extracts_named_unit_parameters():
    text = "- pumping_rate = 5.0e7 1/s\n"
    params = RegexParameterExtractor().extract(text)
    assert len(params) == 1
    p = params[0]
    assert p.name == "pumping_rate"
    assert p.value == 5.0e7
    assert p.unit == "1/s"
    assert p.missing_units is False


def test_flags_missing_units_when_unitless_number():
    text = "- placeholder_efficiency = 0.85\n"
    params = RegexParameterExtractor().extract(text)
    assert len(params) == 1
    p = params[0]
    assert p.missing_units is True
    assert p.unit == ""
    assert "human review" in p.notes.lower()


def test_does_not_fabricate_units_from_prose():
    """Plan §22 — silently inventing units is forbidden. A line like
    `eff = 0.85 the` must NOT be tagged with unit='the'."""
    text = "- eff = 0.85 the rest of this is prose\n"
    params = RegexParameterExtractor().extract(text)
    # Either the row is rejected (if it doesn't fit the pattern) or it
    # comes back with empty unit + missing_units=True. What it MUST NOT do
    # is assign `unit='the rest...'`.
    if params:
        assert params[0].unit in {"", "the rest of this is prose"} or not params[0].unit
        # The strict check: prose fragments aren't valid units.
        assert "rest" not in params[0].unit
        assert params[0].unit.lower() not in {"the", "and", "or", "of", "is"}


def test_extracts_from_fixture_paper():
    text = FIXTURE.read_text()
    params = RegexParameterExtractor().extract(text, source_file=FIXTURE.name)
    names = {p.name for p in params}
    assert "pumping_rate" in names
    assert "placeholder_efficiency" in names
    # The fixture includes pumping_rate (1/s), pulse_duration (ns),
    # pulse_energy (J), ambient_temperature (K), placeholder_efficiency
    # (no unit). placeholder_efficiency must be flagged as missing_units.
    placeholder = next(p for p in params if p.name == "placeholder_efficiency")
    assert placeholder.missing_units is True
    pumping = next(p for p in params if p.name == "pumping_rate")
    assert pumping.unit


def test_skips_comments_and_blanks():
    text = "# comment\n\n  \n- name = 1.0 s\n"
    params = RegexParameterExtractor().extract(text)
    assert len(params) == 1
    assert params[0].name == "name"

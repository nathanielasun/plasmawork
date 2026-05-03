"""Phase 5B — ModuleMatcher integration test."""

from __future__ import annotations

from simworkbench.model_spec import (
    Geometry,
    Model,
    ModelSpec,
    Solvers,
    Species,
)
from simworkbench.model_spec.types import SolverRecommendation
from simworkbench.modeling import ModuleMatcher
from simworkbench.units import Q


def _bare_spec(domain: str = "species") -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="test", domain=domain),
        geometry=Geometry(dimensionality=0),
        species=[Species(name="A", type="atom", initial_density=Q(1.0, "1/m^3"))],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )


def test_match_returns_a_report_with_matches_and_unmatched():
    report = ModuleMatcher().match(_bare_spec())
    assert hasattr(report, "matches")
    assert hasattr(report, "unmatched_requirements")
    # The species/rate_equation_0d module is on disk; it should rank high.
    names = [m.name for m in report.matches]
    assert "rate_equation_0d" in names


def test_match_scores_domain_match_higher_than_mismatch():
    species_report = ModuleMatcher().match(_bare_spec("species"))
    plasma_report = ModuleMatcher().match(_bare_spec("plasma"))
    species_top = species_report.matches[0].sub_scores["domain_match"]
    plasma_top = plasma_report.matches[0].sub_scores["domain_match"]
    # A species-domain spec should match the species/* modules at full
    # score; a plasma-domain spec finds no module in the current
    # registry and tops out lower.
    assert species_top >= plasma_top


def test_match_flags_unmatched_solver():
    spec = _bare_spec()
    # Recommend a solver that doesn't exist as a module.
    spec = spec.model_copy(
        update={
            "solvers": Solvers(
                recommended=[
                    SolverRecommendation(
                        name="no_such_solver_xyz",
                        backend_compatibility=["python_cpu"],
                    )
                ]
            )
        }
    )
    report = ModuleMatcher().match(spec)
    assert any("no_such_solver_xyz" in r for r in report.unmatched_requirements)


def test_unit_compat_rejects_dimensionally_incompatible_outputs(tmp_path):
    """Regression for the post-Phase-5-close finding "module matching can
    report a perfect match without real I/O or unit compatibility".

    A fake module that declares only ``second``-dimensioned outputs must
    NOT score 1.0 against a species-density ModelSpec (whose canonical
    output dimension is number density).
    """
    from pathlib import Path

    fake_root = tmp_path / "fake_modules"
    fake = fake_root / "species" / "fake_only_seconds"
    fake.mkdir(parents=True)
    (fake / "module.yaml").write_text(
        "name: fake_only_seconds\n"
        "version: 0.1.0\n"
        "domain: species\n"
        "status: candidate\n"
        "outputs:\n"
        "  - name: t\n"
        "    units: second\n",
        encoding="utf-8",
    )
    matcher = ModuleMatcher(modules_root=fake_root)
    report = matcher.match(_bare_spec())
    fake_match = next(m for m in report.matches if m.name == "fake_only_seconds")
    # second is one of the expected dims (time axis), so io_match scores
    # partial — but unit_compat should NOT be 1.0 because there's no
    # number-density output.
    assert fake_match.sub_scores["unit_compat"] < 1.0, (
        f"fake_only_seconds scored {fake_match.sub_scores['unit_compat']} "
        "for unit_compat — module-output 'second' is not a number density."
    )
    # And the overall score is below 1.0; nothing about this module
    # genuinely matches a species-density spec.
    assert fake_match.score < 1.0
    # Aggregate compatibility: even though score=0.625 the match is NOT
    # compatible (unit_compat == 0). Carries the post-Phase-5-audit
    # round-2 finding that "0 < score < 1" was treated as "match found".
    assert fake_match.is_compatible is False, (
        "fake_only_seconds is_compatible should be False; aggregate "
        "score-above-threshold is not the same as covering the spec's "
        "required output dimensions."
    )
    # And unmatched_requirements explicitly flags "no module fully covers
    # required output dimensions" so downstream consumers (gap analysis,
    # UI) don't have to re-derive the predicate.
    assert any(
        "fully covers" in row or "required output" in row
        for row in report.unmatched_requirements
    ), report.unmatched_requirements
    _ = Path  # keep import used


def test_gap_analysis_flags_no_compatible_module(tmp_path):
    """Regression: when ModuleMatcher returns matches with score>0 but
    none is fully compatible, GapAnalyzer.missing_modules must surface
    the gap. Earlier the analyzer only consumed
    ``unmatched_requirements`` and missed score-above-zero-but-still-
    incompatible matches.
    """
    from simworkbench.modeling import GapAnalyzer

    fake_root = tmp_path / "fake_modules"
    fake = fake_root / "species" / "fake_only_seconds"
    fake.mkdir(parents=True)
    (fake / "module.yaml").write_text(
        "name: fake_only_seconds\n"
        "version: 0.1.0\n"
        "domain: species\n"
        "status: candidate\n"
        "outputs:\n"
        "  - name: t\n"
        "    units: second\n",
        encoding="utf-8",
    )
    matcher = ModuleMatcher(modules_root=fake_root)
    spec = _bare_spec()
    matches = matcher.match(spec)
    gaps = GapAnalyzer().analyze(spec, matches)
    assert gaps.missing_modules, (
        "GapAnalyzer should populate missing_modules when no module is "
        "fully compatible — even when matches has rows with score > 0."
    )

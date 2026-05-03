"""Phase 5C — GapAnalyzer integration test."""

from __future__ import annotations

from simworkbench.model_spec import (
    Geometry,
    Interaction,
    Model,
    ModelSpec,
    Solvers,
    Species,
)
from simworkbench.model_spec.types import SolverRecommendation
from simworkbench.modeling import GapAnalyzer, ModuleMatcher
from simworkbench.units import Q


def _spec_with_placeholder_rate() -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="t", domain="species"),
        geometry=Geometry(dimensionality=0),
        species=[Species(name="A", type="atom", initial_density=Q(1.0, "1/m^3"))],
        interactions=[
            Interaction(
                name="rate1",
                participants=["A"],
                coefficient_sources=["placeholder:k=1.0 (no unit)"],
            )
        ],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )


def test_report_carries_all_five_categories():
    spec = _spec_with_placeholder_rate()
    matches = ModuleMatcher().match(spec)
    gaps = GapAnalyzer().analyze(spec, matches).to_dict()
    for category in (
        "missing_modules",
        "missing_data",
        "unsupported_regimes",
        "invalid_solver_choices",
        "validation_gaps",
    ):
        assert category in gaps


def test_placeholder_coefficient_flagged_as_missing_data():
    spec = _spec_with_placeholder_rate()
    matches = ModuleMatcher().match(spec)
    gaps = GapAnalyzer().analyze(spec, matches)
    assert any("placeholder" in row for row in gaps.missing_data)


def test_invalid_solver_flagged():
    spec = _spec_with_placeholder_rate().model_copy(
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
    matches = ModuleMatcher().match(spec)
    gaps = GapAnalyzer().analyze(spec, matches)
    assert any("no_such_solver_xyz" in row for row in gaps.invalid_solver_choices)


def test_empty_validation_block_flagged():
    spec = _spec_with_placeholder_rate()
    matches = ModuleMatcher().match(spec)
    gaps = GapAnalyzer().analyze(spec, matches)
    # Default ModelSpec has no acceptance_criteria / conservation_checks.
    assert gaps.validation_gaps

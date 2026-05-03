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

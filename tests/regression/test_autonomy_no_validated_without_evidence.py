"""Phase 10 — Plan §22 Scientific Accuracy Policy regression.

The autonomous pipeline must NEVER produce a `validated` capsule
when any plan flag indicates a placeholder coefficient. The capsule
falls back to `exploratory` until a human reviewer signs off.

This is the cross-tier glue test the Phase 10 milestone Pre-gate
calls out explicitly.
"""

from __future__ import annotations

from simworkbench.autonomy import (
    ExperimentDesigner,
    capsule_status_for_plan,
)
from simworkbench.model_spec import (
    Geometry,
    Model,
    ModelSpec,
    Solvers,
    Species,
)
from simworkbench.model_spec.types import SolverRecommendation
from simworkbench.units import Q


def _spec() -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="evidence_probe", domain="species"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0, "1/m^3"))
        ],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d",
                    backend_compatibility=["python_cpu"],
                )
            ]
        ),
    )


def test_plan_without_placeholders_can_be_validated():
    plan = ExperimentDesigner().design(_spec())
    assert plan.placeholders == []
    # Status defaults to `validated` only when there are no placeholders.
    assert capsule_status_for_plan(plan) == "validated"


def test_plan_with_placeholder_falls_back_to_exploratory():
    plan = ExperimentDesigner().design(_spec())
    flagged = plan.with_placeholder_coefficient("rate_constant_k_AB")
    assert flagged.placeholders == ["rate_constant_k_AB"]
    assert capsule_status_for_plan(flagged) == "exploratory"


def test_multiple_placeholders_remain_exploratory():
    plan = ExperimentDesigner().design(_spec())
    flagged = (
        plan.with_placeholder_coefficient("k_AB")
        .with_placeholder_coefficient("k_BC")
        .with_placeholder_coefficient("E_a")
    )
    assert len(flagged.placeholders) == 3
    assert capsule_status_for_plan(flagged) == "exploratory"

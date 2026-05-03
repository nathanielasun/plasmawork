"""Regression for `bugs_and_fixes/agent_error_patterns.md` "Validation
rule fires after a permissive early-exit".

Phase-6 audit found that ``python_cpu.RatePopulationBackend.initialize``
validated coefficient sources INSIDE the interaction loop, AFTER an
``if len(species_participants) < 2: continue`` early-exit. One-
participant interactions with non-placeholder coefficients silently
``continue``d — never raised, never produced state change. This test
asserts validation fires for every arity (1, 2, 3+).
"""

from __future__ import annotations

import pytest
from simworkbench.experiment import Experiment, RunConfig
from simworkbench.model_spec import (
    Equation,
    Geometry,
    Interaction,
    Model,
    ModelSpec,
    Solvers,
    Species,
)
from simworkbench.model_spec.types import SolverRecommendation
from simworkbench.runtime import Runner
from simworkbench.units import Q


def _spec(*, interaction: Interaction) -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="t", domain="species", version="0.1.0"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0e18, "1/m^3")),
            Species(name="B", type="atom", initial_density=Q(1.0e16, "1/m^3")),
        ],
        interactions=[interaction],
        equations=[Equation(id="eq", latex="dN/dt = -k N")],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )


def _run(spec: ModelSpec) -> None:
    Runner(
        Experiment.from_model_spec(
            spec, run_config=RunConfig(start_time="0 s", end_time="1 ns", max_steps=1)
        ),
        base_seed=0,
    ).run()


def test_one_participant_paper_rate_rejected():
    """One-participant interaction with a non-placeholder paper rate
    must raise — earlier this slipped past the < 2 early-exit."""
    ix = Interaction(
        name="decay_A",
        participants=["A"],
        equation_refs=["eq"],
        coefficient_sources=["paper:k=1.0e7 1/s"],
    )
    with pytest.raises(ValueError, match="placeholder"):
        _run(_spec(interaction=ix))


def test_one_participant_placeholder_runs_as_decay():
    """One-participant interaction with a placeholder rate must run
    (decay term), not silently no-op."""
    ix = Interaction(
        name="decay_A",
        participants=["A"],
        equation_refs=["eq"],
        coefficient_sources=["placeholder:k=1.0e7 1/s (regression)"],
    )
    # No raise: the backend now implements decay for arity-1.
    _run(_spec(interaction=ix))


def test_two_participant_paper_rate_rejected():
    ix = Interaction(
        name="A_to_B",
        participants=["A", "B"],
        equation_refs=["eq"],
        coefficient_sources=["paper:k=1.0e7 1/s"],
    )
    with pytest.raises(ValueError, match="placeholder"):
        _run(_spec(interaction=ix))


def test_three_participants_rejected():
    """Phase 1 declines arity 3+ rather than silently dropping."""
    spec = ModelSpec(
        schema_version="0.1",
        model=Model(name="t", domain="species", version="0.1.0"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0e18, "1/m^3")),
            Species(name="B", type="atom", initial_density=Q(1.0e18, "1/m^3")),
            Species(name="C", type="atom", initial_density=Q(1.0e18, "1/m^3")),
        ],
        interactions=[
            Interaction(
                name="ABC",
                participants=["A", "B", "C"],
                equation_refs=["eq"],
                coefficient_sources=["placeholder:k=1.0e7 1/s"],
            )
        ],
        equations=[Equation(id="eq", latex="dN/dt = -k N")],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )
    with pytest.raises(ValueError, match="3 species participants|kinetic"):
        _run(spec)

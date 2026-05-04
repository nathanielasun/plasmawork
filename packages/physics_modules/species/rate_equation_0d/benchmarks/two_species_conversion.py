"""rate_equation_0d benchmark — A → B mass conservation."""

from __future__ import annotations

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
from simworkbench.validation_library import ConservationCheck, ValidationReport


def run_benchmark() -> ValidationReport:
    spec = ModelSpec(
        schema_version="0.1",
        model=Model(name="conversion_bench", domain="species", version="0.1.0"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0e18, "1/m^3")),
            Species(name="B", type="atom", initial_density=Q(0.0, "1/m^3")),
        ],
        interactions=[
            Interaction(
                name="A_to_B",
                participants=["A", "B"],
                equation_refs=["eq"],
                coefficient_sources=["placeholder:k=1.0 1/s (benchmark)"],
            )
        ],
        equations=[Equation(id="eq", latex="dN_A/dt = -k N_A; dN_B/dt = +k N_A")],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(
            start_time="0 s", end_time="5 s", max_steps=100, seed=0
        ),
    )
    result = Runner(experiment, base_seed=0).run()

    a_series = result.diagnostics["A"]
    b_series = result.diagnostics["B"]
    total = [a + b for a, b in zip(a_series, b_series, strict=True)]

    check = ConservationCheck(
        name="A_plus_B_total_density",
        quantity_series=lambda _: total,
        tolerance_relative=1e-6,
    )
    return check.evaluate(None)


__all__ = ["run_benchmark"]

"""rate_equation_0d benchmark — first-order decay vs closed form.

For a single species under a 1-participant interaction with rate k,
``N(t) = N(0) * exp(-k*t)``. The Phase 1 backend uses ``base_rate=1.0``
internally for placeholder coefficients, so the analytic comparison
runs at k=1.0.
"""

from __future__ import annotations

import math

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
from simworkbench.validation_library import PaperReproduction, ValidationReport


def _spec() -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="decay_bench", domain="species", version="0.1.0"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="A", type="atom", initial_density=Q(1.0e18, "1/m^3")),
        ],
        interactions=[
            Interaction(
                name="decay_A",
                participants=["A"],
                equation_refs=["eq"],
                coefficient_sources=["placeholder:k=1.0 1/s (benchmark)"],
            )
        ],
        equations=[Equation(id="eq", latex="dN_A/dt = -k N_A")],
        solvers=Solvers(
            recommended=[
                SolverRecommendation(
                    name="rate_equation_0d", backend_compatibility=["python_cpu"]
                )
            ]
        ),
    )


def run_benchmark() -> ValidationReport:
    spec = _spec()
    experiment = Experiment.from_model_spec(
        spec,
        run_config=RunConfig(
            start_time="0 s", end_time="10 s", max_steps=200, seed=0
        ),
    )
    result = Runner(experiment, base_seed=0).run()
    final_density = result.diagnostics["A"][-1]
    final_time = result.diagnostics["time_seconds"][-1]
    expected = 1.0e18 * math.exp(-final_time)
    check = PaperReproduction(
        name="first_order_decay",
        observed=float,
        expected=expected,
        tolerance_relative=1e-4,
        reference="N(t) = N(0) exp(-k t), k=1/s",
    )
    return check.evaluate(final_density)


__all__ = ["run_benchmark"]

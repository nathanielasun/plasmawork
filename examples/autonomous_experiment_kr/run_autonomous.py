#!/usr/bin/env python3
"""Phase 10 example — autonomous bounded experiment on a Kr-like spec.

End-to-end pipeline:
  1. ExperimentDesigner produces an ExperimentPlan.
  2. SmokeRunner runs a small probe and reports.
  3. ControlledSweepAgent does a bounded sweep around the MVP point.
  4. ScientificReviewer writes scientific_review.md.

Every step's output is data; nothing leaves
``simulation_capsules/<name>.lxp/`` without an out-of-band approval
token. Plan §22 (Scientific Accuracy Policy) is enforced via
``capsule_status_for_plan`` — placeholder coefficients keep the
capsule `exploratory`.

Usage::

    python examples/autonomous_experiment_kr/run_autonomous.py [capsule_name]
"""

from __future__ import annotations

import sys

from simworkbench.autonomy import (
    ControlledSweepAgent,
    ExperimentDesigner,
    ScientificReviewer,
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
from simworkbench.paths import simulation_capsules_root
from simworkbench.sweep import GridSampler, SweepSpec
from simworkbench.units import Q


def _build_spec() -> ModelSpec:
    return ModelSpec(
        schema_version="0.1",
        model=Model(name="kr_probe", domain="species"),
        geometry=Geometry(dimensionality=0),
        species=[
            Species(name="Kr", type="atom", initial_density=Q(1e22, "1/m^3")),
            Species(name="Kr+", type="ion", initial_density=Q(0.0, "1/m^3")),
            Species(name="e", type="electron", initial_density=Q(0.0, "1/m^3")),
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


def _quadratic_objective(p: dict[str, float]) -> dict[str, float]:
    """Stand-in objective so the example can run without external coefficient
    data. A real workflow would point this at the rate-equation runner."""
    x = float(p.get("x", 0.0))
    return {"loss": (x - 0.7) ** 2}


def main(argv: list[str]) -> int:
    name = argv[1] if len(argv) > 1 else "autonomous_experiment_kr_demo"
    capsule_path = simulation_capsules_root() / f"{name}.lxp"
    (capsule_path / "model").mkdir(parents=True, exist_ok=True)

    spec = _build_spec()
    spec_yaml = capsule_path / "model" / "model_spec.yaml"
    if not spec_yaml.is_file():
        from simworkbench.model_spec import save_yaml

        save_yaml(spec, spec_yaml)

    # Step 1: design.
    plan = ExperimentDesigner().design(spec)
    # Plan §22: this example deliberately flags a placeholder
    # coefficient to demonstrate the exploratory-not-validated rule.
    plan = plan.with_placeholder_coefficient("rate_constant_k_AB")
    status = capsule_status_for_plan(plan)
    print(f"Designed plan: {plan.minimum_viable_model}")
    print(f"  cost estimate: {plan.cost_estimate.total_cpu_seconds:.2f} CPU-s "
          f"on {plan.cost_estimate.backend}")
    print(f"  fidelity ladder: {[s.label for s in plan.fidelity_ladder]}")
    print(f"  capsule status: {status}")

    # Step 2: bounded sweep around an MVP point.
    sweep_spec = SweepSpec(
        name=f"{name}_sweep",
        parameters={"x": [0.0, 0.25, 0.5, 0.75, 1.0]},
        sampler=GridSampler(),
    )
    agent = ControlledSweepAgent(budget=5)
    result = agent.launch_with_summary(sweep_spec, _quadratic_objective)
    print(f"\nSweep: {result.trend_summary}")
    print(f"Recommendation: {result.next_sweep_recommendation}")

    # Step 3: scientific review.
    review_path = ScientificReviewer().write(capsule_path)
    print(f"\nReview written to: {review_path.relative_to(capsule_path)}")
    print(f"Capsule path: {capsule_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(list(sys.argv)))

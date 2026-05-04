#!/usr/bin/env python3
"""Phase 9 example — parameter sweep over a quadratic.

Runs a Latin-hypercube sweep of f(x, y) = (x-1)^2 + (y-2)^2,
ranks the runs by loss, and writes the comparison report into the
capsule directory at ``simulation_capsules/<name>.lxp/comparison/``.
That layout matches the path the API endpoint
``GET /api/comparison/{name}`` reads, so after running this example
the UI's Comparisons tab can render the report immediately.

Usage::

    python examples/parameter_sweep_quadratic/run_sweep.py [capsule_name]

The default capsule name is ``parameter_sweep_quadratic_demo``,
materialised at
``simulation_capsules/parameter_sweep_quadratic_demo.lxp/``.
"""

from __future__ import annotations

import sys

from simworkbench.paths import simulation_capsules_root
from simworkbench.reports import ComparisonReport
from simworkbench.sweep import (
    LatinHypercubeSampler,
    SweepEngine,
    SweepSpec,
)


def quadratic(params: dict[str, float]) -> dict[str, float]:
    x = float(params["x"])
    y = float(params["y"])
    return {
        "loss": (x - 1.0) ** 2 + (y - 2.0) ** 2,
    }


def main(argv: list[str]) -> int:
    name = argv[1] if len(argv) > 1 else "parameter_sweep_quadratic_demo"
    capsule_path = simulation_capsules_root() / f"{name}.lxp"
    capsule_path.mkdir(parents=True, exist_ok=True)

    spec = SweepSpec(
        name=name,
        parameters={"x": (-3.0, 3.0), "y": (-1.0, 5.0)},
        sampler=LatinHypercubeSampler(n_samples=32, seed=0),
    )
    report = SweepEngine(
        spec=spec,
        objective=quadratic,
        checkpoint_path=capsule_path / "sweep_checkpoint.json",
    ).run()

    paths = ComparisonReport(metric="loss", lower_is_better=True).write(
        report, target=capsule_path / "comparison"
    )
    print(f"Sweep id: {report.sweep_id}")
    print(f"Runs completed: {len(report.completed)}")
    best = ComparisonReport(metric="loss").rank(report)[0]
    print(f"Best parameters: {best.parameters}")
    print(f"Best loss: {best.metrics['loss']:.6e}")
    print(f"Capsule: {capsule_path}")
    print(f"Comparison manifest: {paths['manifest']}")
    print(f"Comparison report:   {paths['report']}")
    print(f"View in UI: GET /api/comparison/{capsule_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(list(sys.argv)))

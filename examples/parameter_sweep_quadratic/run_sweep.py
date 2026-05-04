#!/usr/bin/env python3
"""Phase 9 example — parameter sweep over a quadratic.

Runs a Latin-hypercube sweep of f(x, y) = (x-1)^2 + (y-2)^2,
ranks the runs by loss, and writes the comparison report.

Usage::

    python examples/parameter_sweep_quadratic/run_sweep.py [out_dir]

The default output directory is
``temp_runs/parameter_sweep_quadratic_demo`` (a workbench-managed
root).
"""

from __future__ import annotations

import sys
from pathlib import Path

from simworkbench.paths import temp_runs_root
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
    out = (
        Path(argv[1]) if len(argv) > 1
        else temp_runs_root() / "parameter_sweep_quadratic_demo"
    )
    out.mkdir(parents=True, exist_ok=True)

    spec = SweepSpec(
        name="parameter_sweep_quadratic_demo",
        parameters={"x": (-3.0, 3.0), "y": (-1.0, 5.0)},
        sampler=LatinHypercubeSampler(n_samples=32, seed=0),
    )
    report = SweepEngine(
        spec=spec,
        objective=quadratic,
        checkpoint_path=out / "sweep_checkpoint.json",
    ).run()

    paths = ComparisonReport(metric="loss", lower_is_better=True).write(
        report, target=out / "comparison"
    )
    print(f"Sweep id: {report.sweep_id}")
    print(f"Runs completed: {len(report.completed)}")
    best = ComparisonReport(metric="loss").rank(report)[0]
    print(f"Best parameters: {best.parameters}")
    print(f"Best loss: {best.metrics['loss']:.6e}")
    print(f"Comparison manifest: {paths['manifest']}")
    print(f"Comparison report:   {paths['report']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(list(sys.argv)))

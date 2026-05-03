"""0D rate-equation driver — Phase 1D ``candidate`` module.

Wraps ``simworkbench.runtime.Runner`` + ``python_cpu`` backend for callers
that want a one-call simulation entrypoint.
"""

from __future__ import annotations

from simworkbench.experiment import Experiment
from simworkbench.runtime import Runner, RunResult


def simulate(experiment: Experiment, *, base_seed: int = 0) -> RunResult:
    """Run a 0D rate-equation experiment to completion and return the result.

    Caller expectations:
    - ``experiment.model_spec.geometry.dimensionality == 0``
    - ``experiment.backend_config.name == "python_cpu"`` (the default)
    - ``experiment.run_config.{start_time, end_time, max_steps}`` are set

    Backend chooses its internal substepping; the runner samples at the output
    interval ``(end_time - start_time) / max_steps``.
    """
    if experiment.model_spec.geometry.dimensionality != 0:
        raise ValueError(
            "rate_equation_0d.simulate requires a 0D ModelSpec; got "
            f"dimensionality={experiment.model_spec.geometry.dimensionality}."
        )
    runner = Runner(experiment, base_seed=base_seed)
    return runner.run()


__all__ = ["simulate"]

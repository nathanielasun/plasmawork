"""Core package for the Scientific Simulation Workbench.

The ten-phase local workbench scaffold is structurally shipped. The package
surface includes ModelSpec loading, units, experiments, runtime execution,
diagnostics, capsule serialization, validation, registries, provenance,
internal tools, the HTTP API, path helpers, sweeps, and autonomy helpers.

This status is not a scientific trust claim: individual modules and generated
results still carry their own lifecycle, assumptions, validation evidence, and
``exploratory``/``validated`` status.
"""

from __future__ import annotations

from simworkbench.experiment import (
    BackendConfig,
    DiagnosticConfig,
    Experiment,
    ExperimentError,
    RunConfig,
)
from simworkbench.model_spec import ModelSpec

__version__ = "0.1.0"

__all__ = [
    "BackendConfig",
    "DiagnosticConfig",
    "Experiment",
    "ExperimentError",
    "ModelSpec",
    "RunConfig",
    "__version__",
]

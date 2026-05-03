"""Experiment API for the Phase 1 manual workbench.

This package exposes the non-agentic experiment model: a validated ModelSpec
plus run, backend, and diagnostic configuration. Execution lands in
`simworkbench.runtime` during Phase 1C.
"""

from __future__ import annotations

from .types import (
    BackendConfig,
    DiagnosticConfig,
    Experiment,
    ExperimentError,
    RunConfig,
    ToolReference,
)

__all__ = [
    "BackendConfig",
    "DiagnosticConfig",
    "Experiment",
    "ExperimentError",
    "RunConfig",
    "ToolReference",
]

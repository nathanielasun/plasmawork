"""Phase 1C — Simulation runtime.

Public API for the manual workbench runner: ``Runner``, ``RunState``,
``RunResult``, plus the structured event/progress types and
checkpoint/seed helpers.

Importing this package registers the built-in ``python_cpu`` and
``numba_cpu`` backends so a ``Runner`` can be constructed and run
without further setup. Phase 8 / 8A introduces the formal
``SolverBackend`` ABC and ``BackendCapabilities`` descriptor.
"""

from __future__ import annotations

from .checkpoint import (
    Checkpoint,
    checkpoint_dir,
    latest_checkpoint,
    read_checkpoint,
    write_checkpoint,
)
from .events import Event, EventBus, EventLevel, EventListener
from .numba_cpu_backend import NumbaCpuBackend
from .progress import ProgressCallback, ProgressTracker, ProgressUpdate
from .python_cpu import PythonCpuBackend
from .runner import (
    BackendProtocol,
    Runner,
    RunResult,
    RunState,
    get_backend,
    known_backends,
    register_backend,
)
from .seeds import SeedSet, derive
from .solver_backend import BackendCapabilities, SolverBackend

# Phase 8 — augment Phase-1's PythonCpuBackend with the structured
# CAPABILITIES descriptor so the registry can introspect without
# instantiating it.
PythonCpuBackend.CAPABILITIES = BackendCapabilities(  # type: ignore[attr-defined]
    domains=("species", "laser_species", "rate_equations", "phase_transition"),
    geometries=(0,),
    precisions=("float64",),
    deterministic=True,
    determinism_warning="",
)

# Auto-register the built-in backends on import.
register_backend(PythonCpuBackend())
register_backend(NumbaCpuBackend())


__all__ = [
    "BackendCapabilities",
    "BackendProtocol",
    "Checkpoint",
    "Event",
    "EventBus",
    "EventLevel",
    "EventListener",
    "NumbaCpuBackend",
    "ProgressCallback",
    "ProgressTracker",
    "ProgressUpdate",
    "PythonCpuBackend",
    "RunResult",
    "RunState",
    "Runner",
    "SeedSet",
    "SolverBackend",
    "checkpoint_dir",
    "derive",
    "get_backend",
    "known_backends",
    "latest_checkpoint",
    "read_checkpoint",
    "register_backend",
    "write_checkpoint",
]

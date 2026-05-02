"""Phase 1C — Simulation runtime.

Public API for the manual workbench runner: ``Runner``, ``RunState``,
``RunResult``, plus the structured event/progress types and
checkpoint/seed helpers.

Importing this package registers the built-in ``python_cpu`` backend so a
``Runner`` can be constructed and run without further setup.
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
from .progress import ProgressCallback, ProgressTracker, ProgressUpdate
from .python_cpu import PythonCpuBackend
from .runner import (
    BackendProtocol,
    RunResult,
    RunState,
    Runner,
    get_backend,
    known_backends,
    register_backend,
)
from .seeds import SeedSet, derive

# Auto-register the default backend on import.
register_backend(PythonCpuBackend())


__all__ = [
    "BackendProtocol",
    "Checkpoint",
    "Event",
    "EventBus",
    "EventLevel",
    "EventListener",
    "ProgressCallback",
    "ProgressTracker",
    "ProgressUpdate",
    "PythonCpuBackend",
    "RunResult",
    "RunState",
    "Runner",
    "SeedSet",
    "checkpoint_dir",
    "derive",
    "get_backend",
    "known_backends",
    "latest_checkpoint",
    "read_checkpoint",
    "register_backend",
    "write_checkpoint",
]

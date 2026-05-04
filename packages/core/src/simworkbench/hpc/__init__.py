"""Phase 8 / 8E — HPC orchestration.

Public API:

  - ``SlurmJob`` — packages an ``Experiment`` into a Slurm batch
    bundle (``submit.sh``, ``experiment.yaml``, ``run_remote.py``).
    The bundle is self-contained: ``run_remote.py`` re-imports the
    workbench, runs the Experiment, and writes ``result.json``.
  - ``RayAdapter`` — optional Ray-cluster submission helper. Falls
    back to a structured "ray not installed" error when the
    optional dep is missing.
  - ``import_remote_result`` — reads a ``result.json`` produced by
    ``run_remote.py`` and reconstitutes a ``RunResult``-shaped
    object.

The gate-walk test simulates the remote node by running
``run_remote.py`` locally as a subprocess; the orchestrator code path
is what we validate, not Slurm itself.
"""

from __future__ import annotations

from .ray_adapter import RayAdapter, RayUnavailable
from .result_import import import_remote_result
from .slurm import SlurmJob

__all__ = [
    "RayAdapter",
    "RayUnavailable",
    "SlurmJob",
    "import_remote_result",
]

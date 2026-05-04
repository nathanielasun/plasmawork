"""Phase 8 / 8F — External-simulator adapter contract.

External simulators (PIC codes, plasma tools, PDE packages) live
outside this repo. The adapter declares:

  - how to write an input deck the external simulator consumes,
  - how to submit / launch the external job,
  - how to import the resulting artifact back into a workbench
    ``RunResult``-compatible shape.

Phase 8 ships the abstract base + a ``Stub`` concrete adapter under
``packages/solver_backends/external_pic/``. Validated wrappers around
real PIC codes (WarpX, Smilei, EPOCH) are out of scope until the
project owner runs them.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ExternalJobSpec:
    """One job submitted to an external simulator."""

    name: str
    input_deck_path: Path
    submission_args: tuple[str, ...] = ()
    notes: str = ""


class ExternalSimulatorAdapter(abc.ABC):
    """Adapter contract for an external simulator."""

    name: str = ""

    @abc.abstractmethod
    def write_input_deck(self, experiment: Any, target: str | Path) -> Path:
        """Translate ``experiment`` into an external simulator's input
        deck. Returns the path of the written file."""

    @abc.abstractmethod
    def submit(self, job: ExternalJobSpec) -> str:
        """Submit ``job``. Returns a job-tracking handle (e.g. the
        external scheduler's job id)."""

    @abc.abstractmethod
    def import_result(self, job_handle: str, *, target_capsule: str | Path) -> Path:
        """Pull the external simulator's output into a capsule. Returns
        the local path the result lives at."""


__all__ = [
    "ExternalJobSpec",
    "ExternalSimulatorAdapter",
]

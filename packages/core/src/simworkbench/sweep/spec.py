"""Phase 9 / 9A — SweepSpec dataclass.

Declares the parameter grid + sampler + budget for a sweep. Kept
small and serializable so checkpoints round-trip cleanly.

Parameter declarations:
  - ``list[float]`` (or any sequence) — discrete grid axis values.
  - ``tuple[float, float]`` — continuous (low, high) range; samplers
    interpret this as a uniform distribution unless overridden.

The ``sampler`` is one of the concrete classes from
``simworkbench.sweep.samplers`` (or any subclass of ``Sampler``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

# Parameter values: sequence of discrete points OR (low, high) tuple.
ParameterDecl = Sequence[float] | tuple[float, float]


@dataclass
class SweepSpec:
    """One parameter-sweep declaration."""

    name: str
    parameters: dict[str, ParameterDecl]
    sampler: Any  # forward declaration — concrete type in samplers.py
    max_evaluations: int | None = None
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("SweepSpec.name must be non-empty.")
        if not self.parameters:
            raise ValueError("SweepSpec.parameters must be non-empty.")
        if self.max_evaluations is not None and self.max_evaluations <= 0:
            raise ValueError(
                f"SweepSpec.max_evaluations must be positive; got "
                f"{self.max_evaluations!r}."
            )


__all__ = ["ParameterDecl", "SweepSpec"]

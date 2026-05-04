"""Phase 7C PIC adapter — composes EM field + particle pusher.

Skeleton only. Phase 8 brings a real Yee-grid field solver, current
deposition, and a self-consistent loop. The adapter here exposes the
contract so downstream code can be written against the final shape.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PICStepConfig:
    """Configuration for one PIC step."""

    particles_per_cell: int
    deposition_order: int = 1  # 1: NGP, 2: CIC, 3: TSC

    def __post_init__(self) -> None:
        if self.particles_per_cell <= 0:
            raise ValueError("particles_per_cell must be positive")
        if self.deposition_order not in (1, 2, 3):
            raise ValueError(
                "deposition_order must be 1 (NGP), 2 (CIC), or 3 (TSC)"
            )


__all__ = ["PICStepConfig"]

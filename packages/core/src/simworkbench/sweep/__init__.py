"""Phase 9 / 9A — Parameter Sweep engine.

Public API::

    from simworkbench.sweep import (
        SweepSpec, SweepEngine, SweepReport, SweepRow,
        GridSampler, RandomSampler, LatinHypercubeSampler,
        AdaptiveSampler, Sampler,
    )

The sweep engine accepts an objective callable
``params: dict -> metrics: dict``. The objective can wrap a workbench
``Experiment`` + ``Runner`` (real simulation) or any pure function;
the engine doesn't care. The aggregated ``SweepReport`` carries one
row per parameter point with the parameters, metrics, error string,
and parent sweep id.

Plan §Phase 9 / 9A bullets covered here:
  1. Grid sweeps — ``GridSampler``.
  2. Random sweeps — ``RandomSampler``.
  3. Latin hypercube sampling — ``LatinHypercubeSampler``.
  4. Adaptive sweeps — ``AdaptiveSampler`` interface (concrete
     adaptive strategies plug in via ``next_point()``).
  5. Sweep checkpointing — ``checkpoint_path=`` round-trips the
     state across crashes and budget caps.
  6. Sweep result aggregation — ``SweepReport`` dataclass.
"""

from __future__ import annotations

from .checkpoint import SweepCheckpoint
from .engine import SweepEngine, SweepReport, SweepRow
from .samplers import (
    AdaptiveSampler,
    GridSampler,
    LatinHypercubeSampler,
    RandomSampler,
    Sampler,
)
from .spec import SweepSpec

__all__ = [
    "AdaptiveSampler",
    "GridSampler",
    "LatinHypercubeSampler",
    "RandomSampler",
    "Sampler",
    "SweepCheckpoint",
    "SweepEngine",
    "SweepReport",
    "SweepRow",
    "SweepSpec",
]

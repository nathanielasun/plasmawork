"""Phase 9 / 9A — Sweep samplers.

Each sampler turns a ``SweepSpec`` into an iterator of parameter
dicts. Samplers don't run anything; the ``SweepEngine`` consumes the
iterator and dispatches the objective.

Concrete samplers:
  - ``GridSampler``  — Cartesian product over discrete axes.
  - ``RandomSampler`` — uniform random samples in continuous ranges.
  - ``LatinHypercubeSampler`` — stratified random sampling.
  - ``AdaptiveSampler`` — ABC; concrete subclasses plug in
    ``next_point(history)``.
"""

from __future__ import annotations

import abc
import itertools
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from .spec import SweepSpec


class Sampler(abc.ABC):
    """Sampler interface."""

    @abc.abstractmethod
    def points(self, spec: SweepSpec) -> Iterable[dict[str, float]]:
        """Yield parameter dicts. May be a finite or infinite iterator;
        the engine clamps with ``max_evaluations``."""


@dataclass
class GridSampler(Sampler):
    """Cartesian product over discrete sequences.

    Each parameter must be declared as a sequence of values (a list,
    tuple, or array). ``(low, high)`` continuous ranges are not
    supported by GridSampler — use RandomSampler / LHS for those.
    """

    def points(self, spec: SweepSpec) -> Iterable[dict[str, float]]:
        names = list(spec.parameters.keys())
        axis_values: list[Sequence[float]] = []
        for name in names:
            decl = spec.parameters[name]
            is_continuous_range = (
                isinstance(decl, tuple)
                and len(decl) == 2
                and not isinstance(decl[0], (list, tuple))
            )
            if is_continuous_range:
                raise ValueError(
                    f"GridSampler refuses continuous (low, high) range for "
                    f"parameter {name!r}: provide a discrete sequence "
                    "(e.g. list(np.linspace(low, high, n)))."
                )
            axis_values.append(list(decl))
        for combo in itertools.product(*axis_values):
            yield dict(zip(names, combo, strict=True))


def _continuous_bounds(spec: SweepSpec) -> dict[str, tuple[float, float]]:
    bounds: dict[str, tuple[float, float]] = {}
    for name, decl in spec.parameters.items():
        if isinstance(decl, tuple) and len(decl) == 2:
            low, high = decl
            bounds[name] = (float(low), float(high))
        else:
            seq = list(decl)
            if not seq:
                raise ValueError(
                    f"Parameter {name!r} has empty value sequence."
                )
            bounds[name] = (float(min(seq)), float(max(seq)))
    return bounds


@dataclass
class RandomSampler(Sampler):
    """Uniform-random sampling in each parameter's range."""

    n_samples: int
    seed: int = 0

    def __post_init__(self) -> None:
        if self.n_samples <= 0:
            raise ValueError("RandomSampler.n_samples must be positive.")

    def points(self, spec: SweepSpec) -> Iterable[dict[str, float]]:
        rng = np.random.default_rng(self.seed)
        bounds = _continuous_bounds(spec)
        names = list(bounds.keys())
        for _ in range(self.n_samples):
            point: dict[str, float] = {}
            for name in names:
                low, high = bounds[name]
                point[name] = float(rng.uniform(low, high))
            yield point


@dataclass
class LatinHypercubeSampler(Sampler):
    """Latin hypercube sampling — stratified random per axis.

    Each parameter's range is divided into ``n_samples`` strata; each
    stratum receives exactly one sample. Within a stratum the
    location is uniform-random (subject to the seed).
    """

    n_samples: int
    seed: int = 0

    def __post_init__(self) -> None:
        if self.n_samples <= 0:
            raise ValueError("LatinHypercubeSampler.n_samples must be positive.")

    def points(self, spec: SweepSpec) -> Iterable[dict[str, float]]:
        rng = np.random.default_rng(self.seed)
        bounds = _continuous_bounds(spec)
        names = list(bounds.keys())
        n = self.n_samples
        # Per-axis stratified samples.
        per_axis: dict[str, np.ndarray] = {}
        for name in names:
            low, high = bounds[name]
            # One uniform-random offset per stratum; permute strata.
            strata = (np.arange(n) + rng.uniform(0.0, 1.0, size=n)) / n
            rng.shuffle(strata)
            per_axis[name] = low + strata * (high - low)
        for i in range(n):
            yield {name: float(per_axis[name][i]) for name in names}


class AdaptiveSampler(Sampler):
    """Adaptive sampler ABC.

    Concrete adaptive strategies override ``next_point(history)`` to
    consume the history of completed runs and propose the next
    parameter point. ``self._history`` is the live history list the
    engine appends to between yields; concrete subclasses can read it
    from ``next_point``'s ``history`` argument (which IS
    ``self._history``).
    """

    def __init__(self) -> None:
        # Initialized at construction so ``SweepEngine`` can inspect
        # the attribute before the iterator advances. Subclasses that
        # override ``__init__`` should call ``super().__init__()``.
        self._history: list[dict[str, Any]] = []

    @abc.abstractmethod
    def next_point(
        self, spec: SweepSpec, history: list[dict[str, Any]]
    ) -> dict[str, float] | None:
        """Return the next parameter point, or None to stop."""

    def points(self, spec: SweepSpec) -> Iterator[dict[str, float]]:
        # Reset between sweep runs so a sampler reused for two
        # ``SweepEngine.run()`` calls starts fresh each time.
        self._history.clear()
        while True:
            point = self.next_point(spec, self._history)
            if point is None:
                return
            yield point


__all__ = [
    "AdaptiveSampler",
    "GridSampler",
    "LatinHypercubeSampler",
    "RandomSampler",
    "Sampler",
]

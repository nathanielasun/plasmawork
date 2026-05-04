"""Phase 8 / 8A — formal ``SolverBackend`` interface.

This file is the canonical Phase-8 interface document. The Phase-1
runtime defined ``BackendProtocol`` in ``runner.py`` for duck-typing
locally-registered backends; Phase 8 promotes the contract to a real
ABC so that:

  - the type system catches missing methods at definition time
    (``BackendProtocol.Protocol`` only catches them on call),
  - subclasses inherit a ``describe_capabilities()`` default the
    registry can rely on, and
  - the contract is greppable as ``class SolverBackend`` (the
    convention checker asserts this).

Every solver backend (``python_cpu``, ``numba_cpu``, ``cpp``, ...)
declares its capabilities via the ``CAPABILITIES`` class attribute
and overrides the four lifecycle methods. The Phase-1
``BackendProtocol`` continues to apply structurally for legacy
backends, but new backends inherit ``SolverBackend``.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any

from simworkbench.experiment import Experiment
from simworkbench.runtime.seeds import SeedSet


@dataclass(frozen=True)
class BackendCapabilities:
    """Structured capability descriptor.

    Mirrors the ``configs/backends.yaml`` shape so the registry can
    cross-check the YAML against the live backend's declaration.
    """

    domains: tuple[str, ...] = field(default_factory=tuple)
    geometries: tuple[int, ...] = field(default_factory=tuple)
    precisions: tuple[str, ...] = field(default_factory=lambda: ("float64",))
    deterministic: bool = True
    determinism_warning: str = ""

    def covers_modelspec(self, spec: Any) -> bool:
        """Return True iff this backend can handle the given ModelSpec.

        - Geometry dimensionality must be in ``self.geometries``.
        - Spec domain must be in ``self.domains`` (string match).
        """
        try:
            dim = int(spec.geometry.dimensionality)
        except Exception:  # noqa: BLE001
            return False
        if self.geometries and dim not in self.geometries:
            return False
        try:
            domain = str(spec.model.domain).lower()
        except Exception:  # noqa: BLE001
            return False
        if not self.domains:
            return True
        return any(domain == d.lower() or domain.startswith(d.lower()) for d in self.domains)


class SolverBackend(abc.ABC):
    """Abstract base class for every solver backend.

    Subclasses provide a ``CAPABILITIES`` class attribute (used by the
    registry without instantiating the backend) and implement the four
    runtime methods. The runtime invokes the backend via:

        state = backend.initialize(experiment, seeds)
        while not backend.is_complete(state):
            state, samples = backend.step(state, dt)

    ``serialize_state`` / ``deserialize_state`` round-trip the backend
    state through a checkpoint.
    """

    name: str = ""
    CAPABILITIES: BackendCapabilities = BackendCapabilities()

    @abc.abstractmethod
    def initialize(self, experiment: Experiment, seeds: SeedSet) -> Any:
        """Build the backend's internal state from an Experiment."""

    @abc.abstractmethod
    def step(self, state: Any, dt: float) -> tuple[Any, dict[str, Any]]:
        """Advance ``state`` by ``dt`` (seconds). Return ``(new_state, samples)``."""

    @abc.abstractmethod
    def is_complete(self, state: Any) -> bool:
        """Return True when the backend's intrinsic completion fires.
        The runner's ``end_time`` is the primary termination signal;
        backends that have no intrinsic completion return False.
        """

    @abc.abstractmethod
    def serialize_state(self, state: Any) -> Any:
        """Pickle-safe serialization of ``state`` for checkpoints."""

    @abc.abstractmethod
    def deserialize_state(self, payload: Any) -> Any:
        """Inverse of ``serialize_state``."""

    def describe_capabilities(self) -> dict[str, Any]:
        """Return a JSON-serializable capability dump.

        The default surfaces the ``CAPABILITIES`` descriptor + a
        ``determinism`` block consumers (UI, provenance writer) can
        render.
        """
        caps = self.CAPABILITIES
        return {
            "name": self.name,
            "domains": list(caps.domains),
            "geometries": list(caps.geometries),
            "precisions": list(caps.precisions),
            "determinism": {
                "deterministic": bool(caps.deterministic),
                "warning": caps.determinism_warning,
            },
        }


__all__ = [
    "BackendCapabilities",
    "SolverBackend",
]

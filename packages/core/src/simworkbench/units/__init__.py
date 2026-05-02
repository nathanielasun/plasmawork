"""Workbench units subsystem (Phase 1B).

Public API for unit-aware physical quantities. The implementation is `pint`
(see ADR-0004); this package wraps it so consumers depend on the workbench
API, not on `pint` directly.

Typical use::

    from simworkbench.units import Q, require_units, magnitude

    pulse_energy = Q(1.5, "J")
    pulse_duration = Q("25 ns")
    peak_power = pulse_energy / pulse_duration              # 60 MW

    # At a numpy / scipy boundary, drop to a bare magnitude in declared units:
    P_in_watts = magnitude(peak_power, "W")
"""

from __future__ import annotations

from .quantity import (
    Q,
    UnitsError,
    check_dimensionality,
    magnitude,
    parse_quantity,
    to_unit,
)
from .registry import get_registry
from .validators import (
    equations_consistent,
    require_dimensionality,
    require_units,
)

__all__ = [
    "Q",
    "UnitsError",
    "check_dimensionality",
    "equations_consistent",
    "get_registry",
    "magnitude",
    "parse_quantity",
    "require_dimensionality",
    "require_units",
    "to_unit",
]

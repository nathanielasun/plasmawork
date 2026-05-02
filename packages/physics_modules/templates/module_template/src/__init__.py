"""Module template — Phase 1D.

Replace this docstring with the real module's purpose, the regime it applies
to, and the assumptions baked into the implementation. Public functions take
and return ``simworkbench.units.Q`` quantities at the boundary.
"""

from __future__ import annotations

from simworkbench.units import Q


def example(value: object) -> object:
    """Replace with the real public function.

    Inputs and outputs are unit-aware: callers pass strings or ``Q`` objects
    and receive ``Q`` objects back. See ``simworkbench.units.require_units``
    for boundary validation.
    """
    quantity = Q(value)  # parses strings, validates pint quantities
    return quantity


__all__ = ["example"]

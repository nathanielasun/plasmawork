"""Dimensional consistency validators.

Used by `simworkbench.model_spec` to enforce unit correctness at the ModelSpec
boundary, and by physics modules to validate inputs before computation.
"""

from __future__ import annotations

from typing import Any

import pint

from .quantity import Q, UnitsError, check_dimensionality


def require_units(value: Any, *, allow_dimensionless: bool = False) -> pint.Quantity:
    """Reject raw floats / ints; require a quantity with units.

    Used at module and ModelSpec boundaries to enforce the rule from plan §22:
    no raw floats for physical quantities. If `value` is already a Quantity it
    is returned (rebound to the workbench registry); otherwise we raise.

    Strings parse-able as quantities (e.g. `"248 nm"`) are accepted and parsed.
    A string with no unit (e.g. `"5"`) is rejected unless
    `allow_dimensionless=True`.
    """
    if isinstance(value, pint.Quantity):
        if not allow_dimensionless and value.dimensionless:
            raise UnitsError(
                f"Expected a dimensioned quantity, got dimensionless {value!s}."
            )
        return Q(value)

    if isinstance(value, str):
        quantity = Q(value)
        if not allow_dimensionless and quantity.dimensionless:
            raise UnitsError(
                f"Expected a dimensioned quantity, got dimensionless {value!r}."
            )
        return quantity

    raise UnitsError(
        f"Expected a quantity (Quantity or units-string), got {type(value).__name__}: "
        f"{value!r}. Wrap with Q(value, 'unit_string') or pass a string like '1.0 eV'."
    )


def require_dimensionality(value: Any, expected: str) -> pint.Quantity:
    """Require a quantity with the given dimensionality (`require_units` + check)."""
    quantity = require_units(value, allow_dimensionless=False)
    check_dimensionality(quantity, expected)
    return quantity


def equations_consistent(quantities: list[pint.Quantity]) -> bool:
    """Return True iff every quantity in `quantities` shares the same dimensionality.

    Used by ModelSpec equation validation: every term in an equation must
    have the same dimensionality. This is a fast pre-check; full symbolic
    equation analysis is a Phase 5 responsibility.
    """
    if not quantities:
        return True
    reference = quantities[0].dimensionality
    return all(q.dimensionality == reference for q in quantities[1:])


__all__ = ["equations_consistent", "require_dimensionality", "require_units"]

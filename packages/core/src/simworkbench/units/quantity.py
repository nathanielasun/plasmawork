"""Quantity construction and parsing helpers.

The public quantity factory `Q` is exposed from `simworkbench.units`. Helpers
here parse strings (ModelSpec YAML's preferred form) and validate that the
result has the dimensionality the caller expected.
"""

from __future__ import annotations

from typing import Any

import pint

from .registry import get_registry


class UnitsError(ValueError):
    """Raised when a quantity cannot be parsed or has the wrong dimensionality.

    Subclasses `ValueError` so existing pydantic validation chains catch it as
    a regular validation error without special handling.
    """


def Q(value: Any, units: str | None = None) -> pint.Quantity:
    """Construct a workbench `pint.Quantity`.

    Three call shapes supported:

    >>> Q(1.0, "eV")                # numeric + units string
    >>> Q("1.0 eV")                 # single string with magnitude and units
    >>> Q(quantity)                 # passthrough (ensures registry match)

    The returned quantity is always bound to the workbench's `pint.UnitRegistry`
    — dimensional comparisons across capsules and modules therefore stay
    consistent.
    """
    registry = get_registry()

    if isinstance(value, pint.Quantity):
        if units is not None:
            raise UnitsError(
                "Cannot pass both a Quantity and a units string to Q(). "
                "Use Q(value).to(units) to convert."
            )
        # Re-bind to our registry if the quantity was built elsewhere.
        if value._REGISTRY is not registry:  # type: ignore[attr-defined]
            return registry.Quantity(value.magnitude, str(value.units))
        return value

    if isinstance(value, str) and units is None:
        try:
            parsed = registry.parse_expression(value)
        except (pint.errors.UndefinedUnitError, pint.errors.DefinitionSyntaxError) as exc:
            raise UnitsError(f"Could not parse quantity from string {value!r}: {exc}") from exc
        if not isinstance(parsed, pint.Quantity):
            # parse_expression returns plain numbers for unitless strings.
            return registry.Quantity(parsed)
        return parsed

    if units is None:
        # A bare number — treat as dimensionless. Forbid this at module
        # boundaries via require_units(); allow here so unit-aware code can
        # still represent dimensionless ratios deliberately.
        return registry.Quantity(value)

    try:
        return registry.Quantity(value, units)
    except (pint.errors.UndefinedUnitError, pint.errors.DefinitionSyntaxError) as exc:
        raise UnitsError(
            f"Could not construct quantity {value!r} with units {units!r}: {exc}"
        ) from exc


def parse_quantity(text: str, expected_dimensionality: str | None = None) -> pint.Quantity:
    """Parse a quantity from a string, optionally checking its dimensionality.

    `expected_dimensionality` is a pint dimensionality string like
    `"[length]"`, `"[length] / [time]"`, `"[mass] * [length] ** 2 / [time] ** 2"`.
    Pass `None` to skip the check.
    """
    quantity = Q(text)
    if expected_dimensionality is not None:
        check_dimensionality(quantity, expected_dimensionality)
    return quantity


def check_dimensionality(quantity: pint.Quantity, expected: str) -> None:
    """Raise `UnitsError` if `quantity` does not have dimensionality `expected`."""
    registry = get_registry()
    expected_dim = registry.get_dimensionality(expected)
    actual_dim = quantity.dimensionality
    if actual_dim != expected_dim:
        raise UnitsError(
            f"Dimensionality mismatch: expected {expected_dim}, "
            f"got {actual_dim} for quantity {quantity!s}."
        )


def to_unit(quantity: pint.Quantity, target_units: str) -> pint.Quantity:
    """Convert `quantity` to `target_units`, raising `UnitsError` on mismatch.

    Equivalent to `quantity.to(target_units)` but with a workbench-typed error.
    """
    try:
        return quantity.to(target_units)
    except pint.errors.DimensionalityError as exc:
        raise UnitsError(
            f"Cannot convert {quantity!s} to {target_units!r}: {exc}"
        ) from exc


def magnitude(quantity: pint.Quantity, units: str) -> float:
    """Return the bare numeric magnitude of `quantity` after converting to `units`.

    Use this at the boundary between unit-aware workbench APIs and unit-naive
    third-party code (numpy linear algebra, scipy solvers, plotting libraries).
    By naming the target unit explicitly the caller documents the convention
    that the downstream code assumes.
    """
    return float(to_unit(quantity, units).magnitude)


__all__ = [
    "Q",
    "UnitsError",
    "check_dimensionality",
    "magnitude",
    "parse_quantity",
    "to_unit",
]

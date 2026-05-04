"""First-order ionization source terms."""

from __future__ import annotations

import pint
from simworkbench.units import Q, magnitude, require_dimensionality


def ionization_rate(
    neutral_density: pint.Quantity,
    ionization_rate_coefficient: pint.Quantity,
) -> pint.Quantity:
    """Return R_ion = k_ion * N_neutral."""
    require_dimensionality(neutral_density, "1 / [length] ** 3")
    require_dimensionality(ionization_rate_coefficient, "1 / [time]")
    density = magnitude(neutral_density, "1 / meter ** 3")
    rate = magnitude(ionization_rate_coefficient, "1 / second")
    if density < 0 or rate < 0:
        raise ValueError("neutral_density and ionization_rate_coefficient must be non-negative.")
    return Q(density * rate, "1 / (meter ** 3 * second)")


__all__ = ["ionization_rate"]

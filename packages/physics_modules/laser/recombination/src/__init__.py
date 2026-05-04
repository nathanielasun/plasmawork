"""Binary recombination source terms."""

from __future__ import annotations

import pint
from simworkbench.units import Q, magnitude, require_dimensionality


def recombination_rate(
    electron_density: pint.Quantity,
    ion_density: pint.Quantity,
    recombination_coefficient: pint.Quantity,
) -> pint.Quantity:
    """Return R_rec = alpha * n_e * n_i."""
    require_dimensionality(electron_density, "1 / [length] ** 3")
    require_dimensionality(ion_density, "1 / [length] ** 3")
    require_dimensionality(recombination_coefficient, "[length] ** 3 / [time]")
    ne = magnitude(electron_density, "1 / meter ** 3")
    ni = magnitude(ion_density, "1 / meter ** 3")
    alpha = magnitude(recombination_coefficient, "meter ** 3 / second")
    if ne < 0 or ni < 0 or alpha < 0:
        raise ValueError("densities and recombination_coefficient must be non-negative.")
    return Q(alpha * ne * ni, "1 / (meter ** 3 * second)")


__all__ = ["recombination_rate"]

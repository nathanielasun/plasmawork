"""First-order excitation source terms."""

from __future__ import annotations

import pint
from simworkbench.units import Q, magnitude, require_dimensionality


def excitation_rate(
    ground_density: pint.Quantity,
    rate_coefficient: pint.Quantity,
) -> pint.Quantity:
    """Return R_exc = k_exc * N_ground."""
    require_dimensionality(ground_density, "1 / [length] ** 3")
    require_dimensionality(rate_coefficient, "1 / [time]")
    density = magnitude(ground_density, "1 / meter ** 3")
    rate = magnitude(rate_coefficient, "1 / second")
    if density < 0 or rate < 0:
        raise ValueError("ground_density and rate_coefficient must be non-negative.")
    return Q(density * rate, "1 / (meter ** 3 * second)")


__all__ = ["excitation_rate"]

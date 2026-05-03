"""Beer-Lambert linear absorption — Phase 1D ``candidate`` module."""

from __future__ import annotations

import math

import pint
from simworkbench.units import Q, magnitude, require_dimensionality


def absorb(
    *,
    incident_intensity: pint.Quantity,
    absorber_density: pint.Quantity,
    cross_section: pint.Quantity,
    path_length: pint.Quantity,
) -> dict[str, pint.Quantity | float]:
    """Apply linear Beer-Lambert absorption.

    Returns a dict with:
    - ``"transmitted_intensity"``: I(L) = I0 * exp(-alpha * L)  [W/m^2]
    - ``"absorbed_fraction"``: 1 - exp(-alpha * L)  [dimensionless]
    - ``"absorption_coefficient"``: alpha = sigma * n  [1/m]

    All inputs must be unit-aware quantities; raw floats are rejected per
    plan §22 / ADR-0003.
    """
    require_dimensionality(incident_intensity, "[mass] / [time] ** 3")
    require_dimensionality(absorber_density, "1 / [length] ** 3")
    require_dimensionality(cross_section, "[length] ** 2")
    require_dimensionality(path_length, "[length]")

    n = magnitude(absorber_density, "1 / meter ** 3")
    sigma = magnitude(cross_section, "meter ** 2")
    L = magnitude(path_length, "meter")
    I0 = magnitude(incident_intensity, "watt / meter ** 2")

    alpha = n * sigma
    transmitted = I0 * math.exp(-alpha * L)
    absorbed = 1.0 - math.exp(-alpha * L)
    return {
        "transmitted_intensity": Q(transmitted, "watt / meter ** 2"),
        "absorbed_fraction": absorbed,
        "absorption_coefficient": Q(alpha, "1 / meter"),
    }


__all__ = ["absorb"]
